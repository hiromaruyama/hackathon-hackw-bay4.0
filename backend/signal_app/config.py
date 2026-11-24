import re
from dataclasses import dataclass, field
from decimal import Decimal, InvalidOperation
from os import environ
from pathlib import Path
from urllib.parse import urlsplit

from dotenv import dotenv_values


BACKEND_ROOT = Path(__file__).resolve().parents[1]
EMAIL_PATTERN = re.compile(r'[A-Za-z0-9.!#$%&\x27*+/=?^_`{|}~-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+')


def mailbox(value: str) -> str | None:
    value = value.strip().lower()
    return value if EMAIL_PATTERN.fullmatch(value) else None


@dataclass(frozen=True)
class Settings:
    public_origin: str = 'http://localhost:8000'
    demo_username: str = 'demo'
    demo_password: str = field(default='', repr=False)
    session_secret: str = field(default='', repr=False)
    static_dir: Path = BACKEND_ROOT.parent / 'frontend' / 'out'
    anthropic_api_key: str = field(default='', repr=False)
    tavily_api_key: str = field(default='', repr=False)
    discovery_domains: tuple[str, ...] = ()
    hunter_api_key: str = field(default='', repr=False)
    neo4j_uri: str = ''
    neo4j_username: str = 'neo4j'
    neo4j_password: str = field(default='', repr=False)
    neo4j_database: str | None = None
    gmail_client_id: str = ''
    gmail_client_secret: str = field(default='', repr=False)
    gmail_refresh_token: str = field(default='', repr=False)
    gmail_sender: str | None = None
    test_recipient: str | None = None
    suppressed_recipients: frozenset[str] = field(default_factory=frozenset, repr=False)
    flexprice_enabled: bool = False
    flexprice_base_url: str = 'https://us.api.flexprice.io/v1'
    flexprice_api_key: str = field(default='', repr=False)
    flexprice_customer_id: str = ''
    flexprice_external_customer_id: str = ''
    flexprice_wallet_id: str = ''
    flexprice_enrichment_cost: Decimal = Decimal('1')
    flexprice_meter_graph_and_outreach: bool = False
    nexla_sync_url: str = ''
    nexla_access_token: str = field(default='', repr=False)

    @classmethod
    def load(cls) -> 'Settings':
        local = dotenv_values(BACKEND_ROOT / '.env')

        def get(name: str, default: str = '') -> str:
            value = environ.get(name, local.get(name))
            return value.strip() if value else default

        def email(name: str) -> str | None:
            raw = get(name)
            if raw and not mailbox(raw):
                raise ValueError(f'{name} must contain exactly one plain email address.')
            return mailbox(raw)

        origin = get('SIGNAL_PUBLIC_ORIGIN', get('RENDER_EXTERNAL_URL', cls.public_origin)).rstrip('/')
        parsed = urlsplit(origin)
        if parsed.scheme not in ('http', 'https') or not parsed.hostname or parsed.path or parsed.query or parsed.fragment or parsed.username:
            raise ValueError('SIGNAL_PUBLIC_ORIGIN must be an HTTP(S) origin without a path.')

        suppressed = [mailbox(item) for item in get('SIGNAL_SUPPRESSED_RECIPIENTS').split(',') if item.strip()]
        if None in suppressed:
            raise ValueError('SIGNAL_SUPPRESSED_RECIPIENTS must contain comma-separated email addresses.')

        try:
            cost = Decimal(get('FLEXPRICE_ENRICHMENT_COST', '1'))
            if not cost.is_finite() or cost <= 0:
                raise InvalidOperation
        except InvalidOperation:
            raise ValueError('FLEXPRICE_ENRICHMENT_COST must be a positive number.') from None

        return cls(
            public_origin=origin, demo_username=get('SIGNAL_DEMO_USERNAME', 'demo'),
            demo_password=get('SIGNAL_DEMO_PASSWORD'), session_secret=get('SIGNAL_SESSION_SECRET'),
            static_dir=Path(get('SIGNAL_STATIC_DIR', str(cls.static_dir))),
            anthropic_api_key=get('ANTHROPIC_API_KEY'), tavily_api_key=get('TAVILY_API_KEY'),
            discovery_domains=tuple(item.strip() for item in get('SIGNAL_DISCOVERY_DOMAINS').split(',') if item.strip()),
            hunter_api_key=get('HUNTER_API_KEY'), neo4j_uri=get('NEO4J_URI'),
            neo4j_username=get('NEO4J_USERNAME', 'neo4j'), neo4j_password=get('NEO4J_PASSWORD'),
            neo4j_database=get('NEO4J_DATABASE') or None, gmail_client_id=get('GMAIL_CLIENT_ID'),
            gmail_client_secret=get('GMAIL_CLIENT_SECRET'), gmail_refresh_token=get('GMAIL_REFRESH_TOKEN'),
            gmail_sender=email('GMAIL_SENDER_ADDRESS'), test_recipient=email('SIGNAL_TEST_RECIPIENT'),
            suppressed_recipients=frozenset(item for item in suppressed if item),
            flexprice_enabled=get('FLEXPRICE_ENABLED', 'false').lower() == 'true',
            flexprice_base_url=get('FLEXPRICE_BASE_URL', cls.flexprice_base_url).rstrip('/'),
            flexprice_api_key=get('FLEXPRICE_API_KEY'), flexprice_customer_id=get('FLEXPRICE_CUSTOMER_ID'),
            flexprice_external_customer_id=get('FLEXPRICE_EXTERNAL_CUSTOMER_ID'),
            flexprice_wallet_id=get('FLEXPRICE_WALLET_ID'), flexprice_enrichment_cost=cost,
            flexprice_meter_graph_and_outreach=get('FLEXPRICE_METER_GRAPH_AND_OUTREACH', 'false').lower() == 'true',
            nexla_sync_url=get('NEXLA_SYNC_URL'), nexla_access_token=get('NEXLA_ACCESS_TOKEN'),
        )

    @property
    def gmail_configured(self) -> bool:
        return all((self.gmail_client_id, self.gmail_client_secret, self.gmail_refresh_token, self.gmail_sender, self.test_recipient))

    @property
    def flexprice_configured(self) -> bool:
        return all((self.flexprice_api_key, self.flexprice_customer_id, self.flexprice_external_customer_id))
