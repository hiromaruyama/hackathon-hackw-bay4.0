import base64
import logging
import re
from dataclasses import dataclass
from datetime import date, datetime, timezone
from decimal import Decimal, InvalidOperation
from email.message import EmailMessage
from email.utils import parsedate_to_datetime
from hashlib import sha256
from typing import TypeVar
from urllib.parse import urlsplit, urlunsplit

import anthropic
import httpx
from pydantic import BaseModel, ValidationError

from .config import EMAIL_PATTERN, Settings, mailbox
from .errors import ProviderError
from .models import Contact, DraftRevision, EnrichmentStatus, UsageEvent


MODEL = 'claude-haiku-5-5'
Result = TypeVar('Result', bound=BaseModel)
DOMAIN_PATTERN = re.compile(r'(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}')


def stable_id(prefix: str, *parts: str) -> str:
    digest = sha256('\x00'.join(parts).encode()).hexdigest()[:24]
    return f'{prefix}-{digest}'


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def normalize_domain(value: str) -> str | None:
    domain = value.strip().lower().rstrip('.').removeprefix('www.')
    if DOMAIN_PATTERN.fullmatch(domain) and not domain.endswith(('.local', '.internal', '.test')):
        return domain
    return None


def source_url(value: str) -> str | None:
    try:
        parsed = urlsplit(value)
        if parsed.scheme not in ('http', 'https') or not parsed.hostname or parsed.username is not None or parsed.port is not None:
            return None
    except ValueError:
        return None
    if not normalize_domain(parsed.hostname):
        return None
    return urlunsplit((parsed.scheme, parsed.hostname, parsed.path, parsed.query, ''))


def as_date(value: object) -> date | None:
    if not isinstance(value, str):
        return None
    try:
        return date.fromisoformat(value[:10])
    except ValueError:
        try:
            return parsedate_to_datetime(value).date()
        except (TypeError, ValueError):
            return None


def clean_text(value: object, limit: int = 400) -> str:
    if not isinstance(value, str):
        return ''
    return EMAIL_PATTERN.sub('[email redacted]', ' '.join(value.split()))[:limit]


@dataclass(frozen=True)
class Source:
    id: str
    url: str
    title: str
    text: str
    published_at: date | None
    provider: str

    @classmethod
    def parse(cls, row: dict, provider: str) -> 'Source | None':
        raw_url = row.get('url') or row.get('source_url')
        url = source_url(raw_url) if isinstance(raw_url, str) else None
        content = clean_text(row.get('content') or row.get('excerpt'), 3000)
        if not url or not content:
            return None
        return cls(
            id=stable_id('src', url), url=url, title=clean_text(row.get('title'), 200) or url,
            text=content, published_at=as_date(row.get('published_date') or row.get('published_at')),
            provider=provider,
        )

    def prompt_record(self) -> dict:
        return {
            'id': self.id, 'url': self.url, 'title': self.title, 'excerpt': self.text,
            'published_at': self.published_at.isoformat() if self.published_at else None,
        }


@dataclass(frozen=True)
class Enriched:
    status: EnrichmentStatus
    contact: Contact | None


@dataclass(frozen=True)
class Delivery:
    status: str
    provider_message_id: str | None = None


class Providers:
    def __init__(self, settings: Settings, client: httpx.Client | None = None):
        self.settings = settings
        self.http = client or httpx.Client(timeout=httpx.Timeout(10, connect=4), follow_redirects=False)
        self.claude = (
            anthropic.Anthropic(api_key=settings.anthropic_api_key, timeout=16, max_retries=0)
            if settings.anthropic_api_key else None
        )
        # Hunter and Nexla document query authentication. Keep request URLs out of application logs.
        logging.getLogger('httpx').setLevel(logging.WARNING)
        logging.getLogger('httpcore').setLevel(logging.WARNING)
        logging.getLogger('anthropic').setLevel(logging.WARNING)

    def close(self) -> None:
        self.http.close()
        if self.claude:
            self.claude.close()

    def _json(self, provider: str, method: str, url: str, **kwargs):
        try:
            response = self.http.request(method, url, **kwargs)
            response.raise_for_status()
            return response.json()
        except httpx.TimeoutException:
            raise ProviderError(provider, 'timed out. Try again.', 504) from None
        except httpx.HTTPStatusError as exc:
            status = exc.response.status_code
            detail = 'rejected the configured credentials.' if status in (401, 403) else 'did not complete the request.'
            if status == 402:
                detail = 'requires available API credits.'
            if status == 429:
                detail = 'is rate limited or out of credits. Try again later.'
            raise ProviderError(provider, detail) from None
        except (httpx.RequestError, ValueError):
            raise ProviderError(provider) from None

    def complete(self, schema: type[Result], instructions: str, context: str, *, max_tokens: int = 1800) -> Result:
        if not self.claude:
            raise ProviderError('Claude', 'API credentials are missing.', 503)
        try:
            request = dict(model=MODEL, output_format=schema, thinking={'type': 'disabled'},
                           output_config={'effort': 'low'}, system=instructions,
                           messages=[{'role': 'user', 'content': context}])
            response = self.claude.messages.parse(max_tokens=max_tokens, **request)
            if response.stop_reason == 'max_tokens':
                # A bounded retry reuses the already retrieved evidence and does not requery Tavily or Hunter.
                response = self.claude.messages.parse(max_tokens=max_tokens * 2, **request)
            if response.parsed_output is None:
                detail = 'reached its output limit while writing structured data.' if response.stop_reason == 'max_tokens' else 'did not complete the required structured output.'
                raise ProviderError('Claude', detail)
            return response.parsed_output
        except anthropic.APITimeoutError:
            raise ProviderError('Claude', 'timed out. Try again.', 504) from None
        except anthropic.APIStatusError as exc:
            if exc.status_code in (401, 403, 404):
                detail = 'rejected the configured key or model access.'
            elif exc.status_code == 402 or ('credit balance' in str(exc).lower()):
                detail = 'requires available API credits.'
            elif exc.status_code == 429:
                detail = 'is rate limited. Try again later.'
            else:
                detail = 'did not return a usable response.'
            raise ProviderError('Claude', detail) from None
        except (anthropic.APIError, ValidationError, ValueError):
            raise ProviderError('Claude') from None

    def search(self, query: str, *, limit: int = 8) -> list[Source]:
        if not self.settings.tavily_api_key:
            raise ProviderError('Tavily', 'API credentials are missing.', 503)
        payload = self._json(
            'Tavily', 'POST', 'https://api.tavily.com/search',
            headers={'Authorization': f'Bearer {self.settings.tavily_api_key}'},
            json={'query': query[:390], 'search_depth': 'basic', 'max_results': limit,
                  'include_published_date': True, 'include_answer': False},
        )
        results = payload.get('results') if isinstance(payload, dict) else None
        if not isinstance(results, list):
            raise ProviderError('Tavily')
        found = [Source.parse(row, 'tavily') for row in results[:limit] if isinstance(row, dict)]
        return list({source.id: source for source in found if source}.values())

    def nexla_sources(self) -> list[Source]:
        endpoint = self.settings.nexla_sync_url
        token = self.settings.nexla_access_token
        parsed = urlsplit(endpoint)
        if not token or parsed.scheme != 'https' or not parsed.hostname or not parsed.hostname.endswith('.nexla.io') or parsed.username:
            raise ProviderError('Nexla', 'needs a provisioned HTTPS Sync API and API key.', 503)
        payload = self._json(
            'Nexla', 'POST', endpoint, params={'api_key': token}, json={'pagesize': 3, 'offset': 0},
        )
        if isinstance(payload, dict):
            payload = payload.get('data', payload.get('records'))
        if not isinstance(payload, list):
            raise ProviderError('Nexla')
        found = [Source.parse(row, 'nexla') for row in payload[:3] if isinstance(row, dict)]
        return [source for source in found if source]

    def enrich(self, domain: str, target_role: str) -> Enriched:
        if not self.settings.hunter_api_key:
            raise ProviderError('Hunter', 'API credentials are missing.', 503)
        payload = self._json(
            'Hunter', 'GET', 'https://api.hunter.io/v2/domain-search',
            params={'domain': domain, 'type': 'personal', 'limit': 10, 'api_key': self.settings.hunter_api_key},
        )
        data = payload.get('data') if isinstance(payload, dict) else None
        if not isinstance(data, dict) or not isinstance(data.get('emails'), list):
            raise ProviderError('Hunter')

        generic = {'of', 'at', 'and', 'the', 'head', 'director', 'vice', 'president', 'vp', 'chief', 'officer', 'manager', 'senior', 'lead'}
        target = set(re.findall(r'[a-z]+', target_role.lower())) - generic
        candidates = []
        for item in data['emails']:
            if not isinstance(item, dict):
                continue
            address = mailbox(str(item.get('value') or ''))
            position = clean_text(item.get('position'), 160)
            role_words = set(re.findall(r'[a-z]+', position.lower()))
            exact = target_role.casefold() == position.casefold()
            overlap = len(target & role_words)
            if not address or address in self.settings.suppressed_recipients or not position or not (exact or overlap):
                continue
            mail_domain = address.rsplit('@', 1)[1]
            if mail_domain != domain and not mail_domain.endswith('.' + domain):
                continue
            verification = item.get('verification') or {}
            if not isinstance(verification, dict):
                verification = {}
            status = clean_text(verification.get('status'), 40) or None
            if status in ('invalid', 'undeliverable', 'disposable', 'opt_out'):
                continue
            candidates.append((exact, overlap, status == 'valid', address, position, status, verification, item))
        if not candidates:
            return Enriched('not_found', None)

        _, _, verified, address, position, status, verification, item = max(candidates, key=lambda row: row[:3])
        mx = verification.get('mx_records', item.get('mx_records'))
        location = data.get('company') if isinstance(data.get('company'), dict) else {}
        contact = Contact(
            id=stable_id('contact', address), role=position, email_masked=f'•••@{address.rsplit("@", 1)[1]}',
            verification_status=status, mx_valid=mx if isinstance(mx, bool) else None,
            headquarters=clean_text(location.get('headquarters') or data.get('headquarters')) or None,
            linkedin_url=source_url(item['linkedin']) if item.get('linkedin_verified') is True and isinstance(item.get('linkedin'), str) else None,
        )
        return Enriched('verified' if verified else 'uncertain', contact)

    def gmail_access_token(self) -> str:
        if not self.settings.gmail_configured:
            raise ProviderError('Gmail', 'OAuth settings or the controlled test recipient are missing.', 503)
        payload = self._json(
            'Gmail', 'POST', 'https://oauth2.googleapis.com/token',
            data={'client_id': self.settings.gmail_client_id, 'client_secret': self.settings.gmail_client_secret,
                  'refresh_token': self.settings.gmail_refresh_token, 'grant_type': 'refresh_token'},
        )
        token = payload.get('access_token') if isinstance(payload, dict) else None
        if not isinstance(token, str) or not token:
            raise ProviderError('Gmail', 'did not issue an access token.')
        return token

    def send(self, approved: DraftRevision) -> Delivery:
        # Recheck here so the transport is safe even if used outside the HTTP route.
        if approved.test_recipient != self.settings.test_recipient or approved.test_recipient in self.settings.suppressed_recipients:
            return Delivery('failed')
        try:
            token = self.gmail_access_token()
            email = EmailMessage()
            email['From'] = self.settings.gmail_sender
            email['To'] = approved.test_recipient
            email['Subject'] = approved.subject
            email.set_content(approved.body)
        except (ProviderError, ValueError, TypeError):
            return Delivery('failed')
        try:
            response = self.http.post(
                'https://gmail.googleapis.com/gmail/v1/users/me/messages/send',
                headers={'Authorization': f'Bearer {token}'},
                json={'raw': base64.urlsafe_b64encode(email.as_bytes()).decode()},
            )
        except httpx.RequestError:
            return Delivery('pending_outcome')
        if 400 <= response.status_code < 500 and response.status_code != 408:
            return Delivery('failed')
        if response.is_success:
            try:
                message_id = response.json().get('id')
            except (ValueError, AttributeError):
                message_id = None
            if isinstance(message_id, str) and message_id:
                return Delivery('sent', message_id)
        return Delivery('pending_outcome')

    def flexprice_balance(self) -> Decimal:
        if not self.settings.flexprice_configured:
            raise ProviderError('Flexprice', 'sandbox credentials or customer IDs are missing.', 503)
        payload = self._json(
            'Flexprice', 'GET', self.settings.flexprice_base_url + '/customers/wallets',
            headers={'x-api-key': self.settings.flexprice_api_key},
            params={'id': self.settings.flexprice_customer_id, 'include_real_time_balance': 'true'},
        )
        if isinstance(payload, dict):
            payload = payload.get('items', payload.get('wallets', payload.get('data')))
        if not isinstance(payload, list):
            raise ProviderError('Flexprice', 'did not return a wallet list.')
        wallet_id = self.settings.flexprice_wallet_id
        wallets = [row for row in payload if isinstance(row, dict) and row.get('wallet_status') == 'active'
                   and (not wallet_id or row.get('id') == wallet_id)]
        if len(wallets) != 1:
            raise ProviderError('Flexprice', 'needs one configured active sandbox wallet.')
        try:
            balance = Decimal(str(wallets[0]['real_time_credit_balance']))
            if not balance.is_finite():
                raise InvalidOperation
        except (KeyError, InvalidOperation):
            raise ProviderError('Flexprice', 'did not return a usable real-time credit balance.') from None
        return balance

    def meter(self, event: UsageEvent) -> None:
        self._json(
            'Flexprice', 'POST', self.settings.flexprice_base_url + '/events',
            headers={'x-api-key': self.settings.flexprice_api_key},
            json={'event_name': event.operation, 'event_id': event.id,
                  'external_customer_id': self.settings.flexprice_external_customer_id,
                  'timestamp': event.at.isoformat(), 'source': 'signal',
                  'properties': {'account_id': event.account_id, 'quantity': event.units}},
        )
