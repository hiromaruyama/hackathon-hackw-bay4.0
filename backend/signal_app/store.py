from threading import Lock
from typing import Callable, TypeVar

from neo4j import GraphDatabase, ManagedTransaction
from neo4j.exceptions import DriverError, Neo4jError

from .config import Settings
from .errors import ProviderError
from .models import Account, Competitor, Contact, Draft, GraphStep, Product, State
from .providers import stable_id


Value = TypeVar('Value')


class GraphTransaction:
    def __init__(self, tx: ManagedTransaction, workspace_id: str):
        self.tx = tx
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

    def draft(self, draft_id: str, *, lock: bool = False) -> Draft | None:
        query = 'MATCH (d:Draft {workspace: $workspace, id: $id}) '
        if lock:
            query += 'SET d.lock_version = coalesce(d.lock_version, 0) + 1 '
        row = self.run(query + 'RETURN d.data AS data', id=draft_id).single()
        return Draft.model_validate_json(row['data']) if row else None

    def save_draft(self, draft: Draft) -> None:
        self.run(
            'MERGE (d:Draft {workspace: $workspace, id: $id}) '
            'SET d.data = $data, d.account_id = $account, d.icp_revision = $revision',
            id=draft.id, data=draft.model_dump_json(), account=draft.account_id, revision=draft.icp_revision,
        ).consume()

    def save_discovery(self, product: Product, accounts: list[Account], competitor: Competitor | None) -> None:
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

        if competitor:
            self.run(
                'MATCH (p:Product {workspace: $workspace, id: $product}) '
                'MERGE (c:Competitor {workspace: $workspace, id: $id}) SET c += $fields '
                'MERGE (p)-[:COMPETES_WITH]->(c) '
                'WITH c UNWIND $evidence AS item '
                'MERGE (e:Evidence {workspace: $workspace, id: item.id}) SET e += item '
                'MERGE (c)-[:EVIDENCED_BY]->(e)',
                product=product.id, id=stable_id('competitor', competitor.name.casefold()),
                fields=competitor.model_dump(exclude={'evidence'}),
                evidence=[item.model_dump(mode='json') for item in competitor.evidence],
            ).consume()

    def save_contact(self, account_id: str, contact: Contact) -> None:
        self.run(
            'MATCH (c:Company {workspace: $workspace, id: $account}) '
            'MERGE (p:Person {workspace: $workspace, id: $id}) SET p += $fields '
            'MERGE (p)-[:WORKS_AT]->(c)',
            account=account_id, id=contact.id, fields=contact.model_dump(),
        ).consume()

    def graph_path(self, product_id: str, account: Account) -> list[GraphStep]:
        row = self.run(
            'MATCH (p:Product {workspace: $workspace, id: $product})'
            '-[:MATCHED_TO {icp_revision: $revision}]->(c:Company {workspace: $workspace, id: $account}) '
            'OPTIONAL MATCH (c)-[:HAS_SIGNAL {icp_revision: $revision}]->(s:Signal {id: $signal})'
            '-[:EVIDENCED_BY]->(e:Evidence {workspace: $workspace}) '
            'RETURN p.id AS product_id, p.name AS product, c.id AS account_id, c.name AS company, '
            's.id AS signal_id, s.summary AS signal, e.id AS evidence_id',
            product=product_id, revision=account.icp_revision, account=account.id,
            signal=account.signal.id if account.signal else None,
        ).single()
        if row is None:
            return []
        result = [
            GraphStep(id=row['product_id'], label='Product', name=row['product'], relationship='MATCHED_TO'),
            GraphStep(id=row['account_id'], label='Company', name=row['company'],
                      relationship='HAS_SIGNAL' if row['signal_id'] else None, evidence_id=row['evidence_id']),
        ]
        if row['signal_id']:
            result.append(GraphStep(id=row['signal_id'], label='Signal', name=row['signal'], evidence_id=row['evidence_id']))
        return result


class Neo4jStore:
    def __init__(self, settings: Settings, *, workspace_id: str = 'signal-demo'):
        self.database = settings.neo4j_database
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
            graph = GraphTransaction(tx, self.workspace_id)
            return action(graph, graph.state())

        try:
            with self._require_driver().session(database=self.database) as session:
                return session.execute_read(operation)
        except (Neo4jError, DriverError):
            raise ProviderError('Neo4j', 'could not read the workspace. Check the connection.', 503) from None

    def write(self, action: Callable[[GraphTransaction, State], Value]) -> Value:
        def operation(tx):
            graph = GraphTransaction(tx, self.workspace_id)
            state = graph.state(lock=True)
            result = action(graph, state)
            graph.save_state(state)
            return result

        try:
            with self._require_driver().session(database=self.database) as session:
                self._prepare_write(session)
                return session.execute_write(operation)
        except (Neo4jError, DriverError):
            raise ProviderError('Neo4j', 'could not save the workspace. Check the connection.', 503) from None
