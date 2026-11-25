from copy import copy
from datetime import datetime
from threading import Lock
from typing import Callable, TypeVar

from neo4j import GraphDatabase, ManagedTransaction
from neo4j.exceptions import DriverError, Neo4jError

from .config import Settings
from .errors import ProviderError
from .models import Account, Competitor, Contact, Draft, GraphInsight, GraphStep, PipelineEvent, Product, State
from .providers import stable_id


Value = TypeVar('Value')


class GraphTransaction:
    def __init__(self, tx: ManagedTransaction, workspace_id: str, owner_id: str | None = None):
        self.tx = tx
        self.owner_id = owner_id or workspace_id
        self.workspace_id = workspace_id

    def run(self, query: str, **parameters):
        return self.tx.run(query, workspace=self.workspace_id, **parameters)

    def state(self, *, lock: bool = False) -> State:
        query = (
            'MERGE (w:Workspace {id: $workspace}) '
            'SET w.lock_version = coalesce(w.lock_version, 0) + 1 RETURN w.state AS data'
            if lock else 'MATCH (w:Workspace {id: $workspace}) RETURN w.state AS data'
        )
        row = self.run(query).single()
        return State.model_validate_json(row['data']) if row and row['data'] else State()

    def save_state(self, state: State) -> None:
        self.run('MATCH (w:Workspace {id: $workspace}) SET w.state = $data', data=state.model_dump_json()).consume()

    def copy_workspace(self, source: 'GraphTransaction', *, publish: bool) -> State:
        """Copy stored graph edges and draft history atomically. Both namespaces are server-selected."""
        state = source.state()
        self.run(
            'MATCH (n {workspace: $source}) WHERE NOT n:Draft '
            'CREATE (c:$(labels(n))) SET c = properties(n), c.workspace = $workspace '
            'CREATE (n)-[:SIGNAL_COPY]->(c)',
            source=source.workspace_id,
        ).consume()
        self.run(
            'MATCH (x {workspace: $workspace})<-[:SIGNAL_COPY]-(a {workspace: $source})-[r]->'
            '(b {workspace: $source})-[:SIGNAL_COPY]->(y {workspace: $workspace}) '
            'CREATE (x)-[edge:$(type(r))]->(y) SET edge = properties(r)',
            source=source.workspace_id,
        ).consume()
        self.run('MATCH (n {workspace: $source})-[r:SIGNAL_COPY]->(c {workspace: $workspace}) DELETE r',
                 source=source.workspace_id).consume()
        rows = source.run('MATCH (d:Draft {workspace: $workspace}) RETURN d.data AS data')
        drafts = []
        for row in rows:
            draft = Draft.model_validate_json(row['data'])
            if publish:
                # Keep completed deliveries as history. A visitor must approve any new delivery.
                if draft.dispatch:
                    draft.dispatch.provider_message_id = None
                elif not draft.prepared_at:
                    draft.reviews = [r for r in draft.reviews if r.revision != draft.current.revision or r.decision != 'approve']
                    draft.scheduled_at = None
            drafts.append(dict(id=draft.id, account=draft.account_id, revision=draft.icp_revision, data=draft.model_dump_json()))
        self.run('UNWIND $drafts AS item CREATE (d:Draft {workspace: $workspace, id: item.id, '
                 'account_id: item.account, icp_revision: item.revision, data: item.data})', drafts=drafts).consume()
        if publish:
            state.gmail_watch = None
            state.billing_wallet = state.billing_remaining = state.billing_balance_observed = None
            state.usage = None
        self.save_state(state)
        return state

    def reserve_shared_send(self, now: datetime, limit: int, state: State) -> bool:
        # The provider sends to one controlled mailbox across all copies. Seed its window on upgrade.
        key = self.owner_id + ':send-budget'
        row = self.run('MERGE (b:Workspace {id: $key}) SET b.lock_version = coalesce(b.lock_version, 0) + 1 '
                       'RETURN b.attempts AS attempts', key=key).single()
        attempts = row['attempts']
        if attempts is None:
            owner = state if self.workspace_id == self.owner_id else GraphTransaction(self.tx, self.owner_id).state()
            attempts = [e.at.timestamp() for e in owner.activity if e.type == 'dispatch_reserved']
        recent = [at for at in attempts if at > now.timestamp() - 3600]
        if len(recent) >= limit:
            return False
        self.run('MATCH (b:Workspace {id: $key}) SET b.attempts = $attempts',
                 key=key, attempts=[*recent, now.timestamp()]).consume()
        return True

    def draft(self, draft_id: str, *, lock: bool = False) -> Draft | None:
        query = 'MATCH (d:Draft {workspace: $workspace, id: $id}) '
        if lock:
            query += 'SET d.lock_version = coalesce(d.lock_version, 0) + 1 '
        row = self.run(query + 'RETURN d.data AS data', id=draft_id).single()
        return Draft.model_validate_json(row['data']) if row else None

    def drafts_for_revision(self, revision: int) -> dict[str, Draft]:
        rows = self.run(
            'MATCH (d:Draft {workspace: $workspace, icp_revision: $revision}) RETURN d.id AS id, d.data AS data',
            revision=revision,
        )
        return {row['id']: Draft.model_validate_json(row['data']) for row in rows}

    def save_draft(self, draft: Draft) -> None:
        self.run(
            'MERGE (d:Draft {workspace: $workspace, id: $id}) '
            'SET d.data = $data, d.account_id = $account, d.icp_revision = $revision',
            id=draft.id, data=draft.model_dump_json(), account=draft.account_id, revision=draft.icp_revision,
        ).consume()

    def save_discovery(self, product: Product, accounts: list[Account], competitors: list[Competitor]) -> None:
        self.run(
            'MERGE (p:Product {workspace: $workspace, id: $id}) SET p.name = $name, p.description = $description',
            id=product.id, name=product.name, description=product.description,
        ).consume()
        for account in accounts:
            self.run(
                'MATCH (p:Product {workspace: $workspace, id: $product}) '
                'MERGE (c:Company {workspace: $workspace, id: $id}) '
                'SET c.name = $name, c.domain = $domain, c.industry = $industry, c.geography = $geography '
                'MERGE (p)-[m:MATCHED_TO {icp_revision: $revision}]->(c) '
                'SET m.recommendation = $recommendation, m.fit_score = $fit_score '
                'WITH c UNWIND $evidence AS item '
                'MERGE (e:Evidence {workspace: $workspace, id: item.id}) SET e += item '
                'MERGE (c)-[:HAS_EVIDENCE]->(e)',
                product=product.id, id=account.id, name=account.name, domain=account.domain,
                industry=account.industry, geography=account.geography, revision=account.icp_revision,
                recommendation=account.recommendation, fit_score=account.fit_score,
                evidence=[item.model_dump(mode='json') for item in account.evidence],
            ).consume()
            if account.signal:
                self.run(
                    'MATCH (c:Company {workspace: $workspace, id: $company}), '
                    '(e:Evidence {workspace: $workspace, id: $evidence_id}) '
                    'MERGE (s:Signal {workspace: $workspace, id: $id}) SET s += $signal '
                    'MERGE (c)-[:HAS_SIGNAL {icp_revision: $revision}]->(s) '
                    'MERGE (s)-[:EVIDENCED_BY]->(e)',
                    company=account.id, id=account.signal.id, revision=account.icp_revision,
                    evidence_id=account.signal.evidence_id, signal=account.signal.model_dump(mode='json'),
                ).consume()
            self.save_public_signals(account)

        for competitor in competitors:
            self.run(
                'MATCH (p:Product {workspace: $workspace, id: $product}) '
                'MERGE (c:Competitor {workspace: $workspace, id: $id}) SET c += $fields '
                'MERGE (p)-[:COMPETES_WITH]->(c) '
                'WITH c UNWIND $evidence AS item '
                'MERGE (e:Evidence {workspace: $workspace, id: item.id}) SET e += item '
                'MERGE (c)-[:EVIDENCED_BY]->(e)',
                product=product.id, id=stable_id('competitor', competitor.name.casefold()),
                fields=competitor.model_dump(exclude={'evidence', 'plans'}),
                evidence=[item.model_dump(mode='json') for item in competitor.evidence],
            ).consume()

    def save_contact(self, account_id: str, contact: Contact) -> None:
        self.run(
            'MATCH (c:Company {workspace: $workspace, id: $account}) '
            'MERGE (p:Person {workspace: $workspace, id: $id}) SET p += $fields '
            'MERGE (p)-[:WORKS_AT]->(c)',
            account=account_id, id=contact.id, fields=contact.model_dump(),
        ).consume()

    def save_public_signals(self, account: Account) -> None:
        self.run(
            'MATCH (c:Company {workspace: $workspace, id: $account})'
            '-[r:HAS_MARKET_SIGNAL {icp_revision: $revision}]->(:Signal) SET r.active = false',
            account=account.id, revision=account.icp_revision,
        ).consume()
        self.run(
            'MATCH (c:Company {workspace: $workspace, id: $account})'
            '<-[:WORKS_AT {icp_revision: $revision}]-(:Person)'
            '-[r:PREVIOUSLY_EMPLOYED_AT|ALUMNI_OF {icp_revision: $revision}]->() SET r.active = false',
            account=account.id, revision=account.icp_revision,
        ).consume()
        for affiliation in account.affiliations:
            node_label, edge_type = ('Company', 'PREVIOUSLY_EMPLOYED_AT') if affiliation.kind == 'employment' else ('Institution', 'ALUMNI_OF')
            self.run(
                'MATCH (c:Company {workspace: $workspace, id: $account}) '
                'MERGE (p:Person {workspace: $workspace, id: $person_id}) SET p.name = $person '
                'MERGE (p)-[:WORKS_AT {icp_revision: $revision}]->(c) '
                f'MERGE (o:{node_label} {{workspace: $workspace, id: $organization_id}}) SET o.name = $organization '
                f'MERGE (p)-[r:{edge_type} {{icp_revision: $revision, evidence_id: $evidence_id}}]->(o) SET r.active = true',
                account=account.id, revision=account.icp_revision, person=affiliation.person, organization=affiliation.organization,
                person_id=stable_id('public-person', account.id, affiliation.person.casefold()),
                organization_id=stable_id('affiliation', affiliation.organization.casefold()), evidence_id=affiliation.evidence_id,
            ).consume()
        for signal in account.market_signals:
            self.run(
                'MATCH (c:Company {workspace: $workspace, id: $account}), '
                '(e:Evidence {workspace: $workspace, id: $evidence}) '
                'MERGE (s:Signal {workspace: $workspace, id: $id}) SET s += $fields '
                'MERGE (c)-[r:HAS_MARKET_SIGNAL {icp_revision: $revision}]->(s) SET r.active = true '
                'MERGE (s)-[:EVIDENCED_BY]->(e)',
                account=account.id, revision=account.icp_revision, id=signal.id,
                evidence=signal.evidence_id, fields=signal.model_dump(mode='json'),
            ).consume()
            if signal.vendor:
                self.run(
                    'MATCH (s:Signal {workspace: $workspace, id: $signal}) '
                    'MERGE (v:Competitor {workspace: $workspace, id: $vendor_id}) SET v.name = $vendor '
                    'MERGE (s)-[:RELATES_TO]->(v)',
                    signal=signal.id, vendor=signal.vendor, vendor_id=stable_id('competitor', signal.vendor.casefold()),
                ).consume()

    def insights(self, account: Account) -> list[GraphInsight]:
        rows = self.run(
            'MATCH (c:Company {workspace: $workspace, id: $account})'
            '<-[:WORKS_AT {icp_revision: $revision}]-(p:Person)'
            '-[r:PREVIOUSLY_EMPLOYED_AT|ALUMNI_OF {icp_revision: $revision}]->(o), '
            '(e:Evidence {workspace: $workspace, id: r.evidence_id}) '
            'WHERE coalesce(r.active, true) '
            'RETURN CASE type(r) WHEN "PREVIOUSLY_EMPLOYED_AT" THEN "employment" ELSE "education" END AS kind, '
            '[c.name, p.name, o.name] AS path, [properties(e)] AS evidence LIMIT 8 '
            'UNION ALL '
            'MATCH (c:Company {workspace: $workspace, id: $account})'
            '<-[:WORKS_AT {icp_revision: $revision}]-(p:Person)'
            '-[r:PREVIOUSLY_EMPLOYED_AT|ALUMNI_OF {icp_revision: $revision}]->(o)'
            '<-[q:PREVIOUSLY_EMPLOYED_AT|ALUMNI_OF {icp_revision: $revision}]-(peer:Person)'
            '-[:WORKS_AT {icp_revision: $revision}]->(peer_company:Company), '
            '(e:Evidence {workspace: $workspace, id: r.evidence_id}), (f:Evidence {workspace: $workspace, id: q.evidence_id}) '
            'WHERE p.id <> peer.id AND c.id <> peer_company.id AND type(r) = type(q) AND coalesce(r.active, true) AND coalesce(q.active, true) '
            'RETURN "warm_introduction" AS kind, [p.name, o.name, peer.name, peer_company.name] AS path, '
            '[properties(e), properties(f)] AS evidence LIMIT 8 '
            'UNION ALL '
            'MATCH (c:Company {workspace: $workspace, id: $account})'
            '-[m:HAS_MARKET_SIGNAL {icp_revision: $revision}]->(s:Signal)-[:EVIDENCED_BY]->(e:Evidence) '
            'WHERE coalesce(m.active, true) '
            'OPTIONAL MATCH (s)-[:RELATES_TO]->(v:Competitor) '
            'RETURN s.kind AS kind, CASE WHEN v IS NULL THEN [c.name, e.title] ELSE [c.name, v.name] END AS path, '
            '[properties(e)] AS evidence LIMIT 12',
            account=account.id, revision=account.icp_revision,
        )
        unique = {}
        for row in rows:
            item = GraphInsight.model_validate(dict(row))
            unique[item.kind, tuple(item.path)] = item
        return list(unique.values())

    def record_pipeline_event(self, event: PipelineEvent, prior_send: str | None) -> None:
        self.run(
            'MERGE (i:Interaction {workspace: $workspace, id: $id}) SET i += $fields',
            id=event.id, fields=event.model_dump(mode='json'),
        ).consume()
        if event.action == 'send':
            self.run(
                'MATCH (c:Company {workspace: $workspace, id: $account}), '
                '(i:Interaction {workspace: $workspace, id: $id}) '
                'MERGE (c)-[:CONTACTED_VIA {channel: "email", test_send: true}]->(i)',
                id=event.id, account=event.account_id,
            ).consume()
        elif event.action == 'reply' and prior_send:
            self.run(
                'MATCH (r:Interaction {workspace: $workspace, id: $id}), '
                '(s:Interaction {workspace: $workspace, id: $send}) MERGE (r)-[:REPLIED_TO]->(s)',
                id=event.id, send=prior_send,
            ).consume()

    def graph_path(self, product_id: str, account: Account) -> list[GraphStep]:
        return self.graph_paths(product_id, [account]).get(account.id, [])

    def graph_paths(self, product_id: str, accounts: list[Account]) -> dict[str, list[GraphStep]]:
        if not accounts:
            return {}
        rows = self.run(
            'UNWIND $accounts AS matched '
            'MATCH (p:Product {workspace: $workspace, id: $product})'
            '-[:MATCHED_TO {icp_revision: matched.revision}]->(c:Company {workspace: $workspace, id: matched.id}) '
            'OPTIONAL MATCH (c)-[:HAS_SIGNAL {icp_revision: matched.revision}]->(s:Signal {id: matched.signal})'
            '-[:EVIDENCED_BY]->(e:Evidence {workspace: $workspace}) '
            'RETURN p.id AS product_id, p.name AS product, c.id AS account_id, c.name AS company, '
            's.id AS signal_id, s.summary AS signal, e.id AS evidence_id',
            product=product_id,
            accounts=[{'id': account.id, 'revision': account.icp_revision, 'signal': account.signal.id if account.signal else None}
                      for account in accounts],
        )
        paths = {}
        for row in rows:
            steps = [
                GraphStep(id=row['product_id'], label='Product', name=row['product'], relationship='MATCHED_TO'),
                GraphStep(id=row['account_id'], label='Company', name=row['company'],
                          relationship='HAS_SIGNAL' if row['signal_id'] else None, evidence_id=row['evidence_id']),
            ]
            if row['signal_id']:
                steps.append(GraphStep(id=row['signal_id'], label='Signal', name=row['signal'], evidence_id=row['evidence_id']))
            paths[row['account_id']] = steps
        return paths


class Neo4jStore:
    def __init__(self, settings: Settings, *, workspace_id: str = 'signal-demo'):
        self.database = settings.neo4j_database
        self.owner_id = workspace_id
        self.judge_expires: int | None = None
        self.template_id = workspace_id + ':judge-template'
        self.workspace_id = workspace_id
        self.driver = None
        if settings.neo4j_uri:
            auth = (settings.neo4j_username, settings.neo4j_password) if settings.neo4j_password else None
            self.driver = GraphDatabase.driver(
                settings.neo4j_uri, auth=auth, connection_timeout=5, connection_acquisition_timeout=8,
                max_transaction_retry_time=4,
            )
        self._schema_lock = Lock()
        self._schema_ready = False

    def for_judge(self, actor: str, expires: int) -> 'Neo4jStore':
        scoped = copy(self)
        scoped.workspace_id = self.owner_id + ':' + actor
        scoped.judge_expires = expires
        return scoped

    def prepare_judging(self, now: int) -> None:
        def prepare(tx):
            template = GraphTransaction(tx, self.template_id)
            row = template.run('MATCH (w:Workspace {id: $workspace}) RETURN w.state IS NOT NULL AS ready').single()
            if not row or not row['ready']:
                # Serialize first visitors, then lock the owner for one consistent published snapshot.
                ready = template.run('MERGE (w:Workspace {id: $workspace}) '
                                     'SET w.lock_version = coalesce(w.lock_version, 0) + 1 RETURN w.state IS NOT NULL AS ready').single()
                if not ready['ready']:
                    owner = GraphTransaction(tx, self.owner_id)
                    owner.run('MERGE (w:Workspace {id: $workspace}) SET w.lock_version = coalesce(w.lock_version, 0) + 1').consume()
                    template.copy_workspace(owner, publish=True)
            template.run('MATCH (w:Workspace {judge_owner: $owner}) WHERE w.judge_expires <= $now '
                         'WITH w LIMIT 2 OPTIONAL MATCH (n {workspace: w.id}) DETACH DELETE n, w',
                         owner=self.owner_id, now=now).consume()

        try:
            with self._require_driver().session(database=self.database) as session:
                self._prepare_write(session)
                session.execute_write(prepare)
        except (Neo4jError, DriverError):
            raise ProviderError('Neo4j', 'could not open a private judging workspace.', 503) from None

    def close(self) -> None:
        if self.driver:
            self.driver.close()

    def check(self) -> bool:
        if not self.driver:
            return False
        try:
            with self.driver.session(database=self.database) as session:
                row = session.run('RETURN 1 AS ready').single()
                return bool(row and row['ready'] == 1)
        except (Neo4jError, DriverError):
            return False

    def _require_driver(self):
        if not self.driver:
            raise ProviderError('Neo4j', 'connection settings are missing.', 503)
        return self.driver

    def _prepare_write(self, session) -> None:
        with self._schema_lock:
            if self._schema_ready:
                return
            session.run('CREATE CONSTRAINT signal_workspace_id IF NOT EXISTS FOR (w:Workspace) REQUIRE w.id IS UNIQUE').consume()
            self._schema_ready = True

    def read(self, action: Callable[[GraphTransaction, State], Value]) -> Value:
        def operation(tx):
            namespace = self.workspace_id
            if self.judge_expires is not None:
                # Read-only visits share an immutable snapshot, including real graph traversals.
                row = tx.run('MATCH (w:Workspace {id: $id}) RETURN w.id AS id', id=namespace).single()
                if not row:
                    namespace = self.template_id
            graph = GraphTransaction(tx, namespace, self.owner_id)
            return action(graph, graph.state())

        try:
            with self._require_driver().session(database=self.database) as session:
                return session.execute_read(operation)
        except (Neo4jError, DriverError):
            raise ProviderError('Neo4j', 'could not read the workspace. Check the connection.', 503) from None

    def write(self, action: Callable[[GraphTransaction, State], Value]) -> Value:
        def operation(tx):
            graph = GraphTransaction(tx, self.workspace_id, self.owner_id)
            state = graph.state(lock=True)
            if self.judge_expires is not None:
                row = graph.run('MATCH (w:Workspace {id: $workspace}) RETURN w.judge_owner AS owner').single()
                if not row['owner']:
                    state = graph.copy_workspace(GraphTransaction(tx, self.template_id), publish=False)
                    graph.run('MATCH (w:Workspace {id: $workspace}) SET w.judge_owner = $owner, w.judge_expires = $expires',
                              owner=self.owner_id, expires=self.judge_expires).consume()
            result = action(graph, state)
            graph.save_state(state)
            return result

        try:
            with self._require_driver().session(database=self.database) as session:
                self._prepare_write(session)
                return session.execute_write(operation)
        except (Neo4jError, DriverError):
            raise ProviderError('Neo4j', 'could not save the workspace. Check the connection.', 503) from None
