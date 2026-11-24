import re
from dataclasses import dataclass, field
from decimal import Decimal, InvalidOperation
from os import environ
from pathlib import Path
from urllib.parse import urlsplit

from dotenv import dotenv_values


BACKEND_ROOT = Path(__file__).resolve().parents[1]
GMAIL_PUSH_PATH = '/api/webhooks/gmail'
PUBSUB_RESOURCE = re.compile(r'projects/([a-z][a-z0-9-]{4,28}[a-z0-9])/(topics|subscriptions)/[A-Za-z][A-Za-z0-9_.~+%-]{2,254}')
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
    research_refresh_minutes: int = 0
    hunter_api_key: str = field(default='', repr=False)
    neo4j_uri: str = ''
    neo4j_username: str = 'neo4j'
    neo4j_password: str = field(default='', repr=False)
    neo4j_database: str | None = None
    gmail_client_id: str = ''
    gmail_client_secret: str = field(default='', repr=False)
    gmail_refresh_token: str = field(default='', repr=False)
    gmail_feedback_refresh_token: str = field(default='', repr=False)
    gmail_pubsub_topic: str = ''
    gmail_pubsub_subscription: str = ''
    gmail_pubsub_service_account: str | None = None
    gmail_sender: str | None = None
    test_recipient: str | None = None
    test_send_limit_per_hour: int = 6
    linkedin_test_profile_url: str | None = None
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
    elevenlabs_api_key: str = field(default='', repr=False)
    elevenlabs_agent_id: str = ''

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

        gmail_topic = get('GMAIL_PUBSUB_TOPIC')
        gmail_subscription = get('GMAIL_PUBSUB_SUBSCRIPTION')
        gmail_push_account = email('GMAIL_PUBSUB_SERVICE_ACCOUNT')
        if any((gmail_topic, gmail_subscription, gmail_push_account)):
            topic = PUBSUB_RESOURCE.fullmatch(gmail_topic)
            subscription = PUBSUB_RESOURCE.fullmatch(gmail_subscription)
            if (not topic or not subscription or topic[1] != subscription[1]
                    or topic[2] != 'topics' or subscription[2] != 'subscriptions'):
                raise ValueError('Use full Gmail Pub/Sub topic and subscription names in the same Google Cloud project.')
            if not gmail_push_account or not gmail_push_account.endswith('.iam.gserviceaccount.com'):
                raise ValueError('GMAIL_PUBSUB_SERVICE_ACCOUNT must be a dedicated Google service account email.')
            if parsed.scheme != 'https':
                raise ValueError('Gmail Pub/Sub push requires an HTTPS SIGNAL_PUBLIC_ORIGIN.')

        linkedin_profile = get('SIGNAL_LINKEDIN_TEST_PROFILE_URL')
        if linkedin_profile:
            profile = urlsplit(linkedin_profile)
            if profile.scheme != 'https' or profile.netloc not in ('www.linkedin.com', 'linkedin.com') or not re.fullmatch(r'/in/[A-Za-z0-9_-]{1,150}/?', profile.path) or profile.query or profile.fragment:
                raise ValueError('SIGNAL_LINKEDIN_TEST_PROFILE_URL must be an HTTPS LinkedIn profile URL.')

        try:
            cost = Decimal(get('FLEXPRICE_ENRICHMENT_COST', '1'))
            if not cost.is_finite() or cost <= 0:
                raise InvalidOperation
        except InvalidOperation:
            raise ValueError('FLEXPRICE_ENRICHMENT_COST must be a positive number.') from None

        try:
            refresh_minutes = int(get('SIGNAL_RESEARCH_REFRESH_MINUTES', '0'))
            if refresh_minutes < 0:
                raise ValueError
        except ValueError:
            raise ValueError('SIGNAL_RESEARCH_REFRESH_MINUTES must be a nonnegative integer.') from None

        try:
            test_send_limit = int(get('SIGNAL_TEST_SEND_LIMIT_PER_HOUR', '6'))
            if test_send_limit < 1:
                raise ValueError
        except ValueError:
            raise ValueError('SIGNAL_TEST_SEND_LIMIT_PER_HOUR must be a positive integer.') from None

        return cls(
            public_origin=origin, demo_username=get('SIGNAL_DEMO_USERNAME', 'demo'),
            demo_password=get('SIGNAL_DEMO_PASSWORD'), session_secret=get('SIGNAL_SESSION_SECRET'),
            static_dir=Path(get('SIGNAL_STATIC_DIR', str(cls.static_dir))),
            anthropic_api_key=get('ANTHROPIC_API_KEY'), tavily_api_key=get('TAVILY_API_KEY'),
            discovery_domains=tuple(item.strip() for item in get('SIGNAL_DISCOVERY_DOMAINS').split(',') if item.strip()),
            research_refresh_minutes=refresh_minutes,
            hunter_api_key=get('HUNTER_API_KEY'), neo4j_uri=get('NEO4J_URI'),
            neo4j_username=get('NEO4J_USERNAME', 'neo4j'), neo4j_password=get('NEO4J_PASSWORD'),
            neo4j_database=get('NEO4J_DATABASE') or None, gmail_client_id=get('GMAIL_CLIENT_ID'),
            gmail_client_secret=get('GMAIL_CLIENT_SECRET'), gmail_refresh_token=get('GMAIL_REFRESH_TOKEN'),
            gmail_feedback_refresh_token=get('GMAIL_FEEDBACK_REFRESH_TOKEN'),
            gmail_pubsub_topic=gmail_topic, gmail_pubsub_subscription=gmail_subscription,
            gmail_pubsub_service_account=gmail_push_account,
            gmail_sender=email('GMAIL_SENDER_ADDRESS'), test_recipient=email('SIGNAL_TEST_RECIPIENT'),
            test_send_limit_per_hour=test_send_limit,
            linkedin_test_profile_url=linkedin_profile or None,
            suppressed_recipients=frozenset(item for item in suppressed if item),
            flexprice_enabled=get('FLEXPRICE_ENABLED', 'false').lower() == 'true',
            flexprice_base_url=get('FLEXPRICE_BASE_URL', cls.flexprice_base_url).rstrip('/'),
            flexprice_api_key=get('FLEXPRICE_API_KEY'), flexprice_customer_id=get('FLEXPRICE_CUSTOMER_ID'),
            flexprice_external_customer_id=get('FLEXPRICE_EXTERNAL_CUSTOMER_ID'),
            flexprice_wallet_id=get('FLEXPRICE_WALLET_ID'), flexprice_enrichment_cost=cost,
            flexprice_meter_graph_and_outreach=get('FLEXPRICE_METER_GRAPH_AND_OUTREACH', 'false').lower() == 'true',
            nexla_sync_url=get('NEXLA_SYNC_URL'), nexla_access_token=get('NEXLA_ACCESS_TOKEN'),
            elevenlabs_api_key=get('ELEVENLABS_API_KEY'), elevenlabs_agent_id=get('ELEVENLABS_AGENT_ID'),
        )

    @property
    def gmail_configured(self) -> bool:
        return all((self.gmail_client_id, self.gmail_client_secret, self.gmail_refresh_token, self.gmail_sender, self.test_recipient))

    @property
    def chat_configured(self) -> bool:
        return bool(self.elevenlabs_api_key and self.elevenlabs_agent_id)

    @property
    def gmail_feedback_configured(self) -> bool:
        return all((self.gmail_client_id, self.gmail_client_secret, self.gmail_feedback_refresh_token,
                    self.gmail_sender, self.test_recipient))

    @property
    def gmail_push_configured(self) -> bool:
        return self.gmail_feedback_configured and all((self.gmail_pubsub_topic, self.gmail_pubsub_subscription,
                                                       self.gmail_pubsub_service_account))

    @property
    def gmail_push_audience(self) -> str:
        return self.public_origin + GMAIL_PUSH_PATH

    @property
    def flexprice_configured(self) -> bool:
        return all((self.flexprice_api_key, self.flexprice_customer_id, self.flexprice_external_customer_id))
