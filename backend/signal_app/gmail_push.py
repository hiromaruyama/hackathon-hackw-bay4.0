import base64
import binascii
import json
from threading import Lock
from time import monotonic

import httpx
from fastapi import Request
from google.auth import exceptions, jwt

from .config import Settings, mailbox
from .errors import ProviderError, SignalError
from .providers import gmail_history_id


GOOGLE_CERTS_URL = 'https://www.googleapis.com/oauth2/v1/certs'
GOOGLE_ISSUERS = {'accounts.google.com', 'https://accounts.google.com'}
MAX_PUSH_BYTES = 16_384


class GmailPushAuthenticator:
    def __init__(self, settings: Settings, http: httpx.Client):
        self.settings = settings
        self.http = http
        self._certs: dict[str, str] = {}
        self._fetched_at = float('-inf')
        self._lock = Lock()

    def _certificates(self, kid: str) -> dict[str, str]:
        with self._lock:
            age = monotonic() - self._fetched_at
            if age >= 300 or (kid not in self._certs and age >= 60):
                try:
                    response = self.http.get(GOOGLE_CERTS_URL)
                    response.raise_for_status()
                    certs = response.json()
                    if not isinstance(certs, dict) or not certs or not all(isinstance(cert, str) for cert in certs.values()):
                        raise ValueError('Invalid Google certificate set.')
                except (httpx.HTTPError, ValueError):
                    raise ProviderError('Google Pub/Sub', 'signing certificates are temporarily unavailable.', 503) from None
                self._certs = certs
                self._fetched_at = monotonic()
            return self._certs

    def authorize(self, authorization: str) -> None:
        if not self.settings.gmail_push_configured:
            raise SignalError('gmail_push_unconfigured', 'Configure Gmail Pub/Sub push to receive notifications.', 503)
        scheme, _, token = authorization.partition(' ')
        denied = SignalError('invalid_gmail_push_token', 'A signed Google Pub/Sub token is required.', 401)
        if scheme.lower() != 'bearer' or not token or len(token) > 4096:
            raise denied
        try:
            header = jwt.decode_header(token)
            kid = header.get('kid')
            if header.get('alg') != 'RS256' or not isinstance(kid, str) or not kid:
                raise denied
            claims = jwt.decode(token, certs=self._certificates(kid), audience=self.settings.gmail_push_audience)
        except (ValueError, TypeError, exceptions.GoogleAuthError):
            raise denied from None
        if (claims.get('iss') not in GOOGLE_ISSUERS
                or claims.get('aud') != self.settings.gmail_push_audience
                or claims.get('email_verified') is not True
                or claims.get('email') != self.settings.gmail_pubsub_service_account):
            raise denied


async def gmail_notification(request: Request, settings: Settings) -> int:
    body = bytearray()
    async for chunk in request.stream():
        if len(body) + len(chunk) > MAX_PUSH_BYTES:
            raise SignalError('gmail_push_too_large', 'The Pub/Sub notification exceeds the size limit.', 413)
        body.extend(chunk)
    try:
        envelope = json.loads(body)
        if envelope['subscription'] != settings.gmail_pubsub_subscription:
            raise SignalError('gmail_push_subscription_mismatch', 'The Pub/Sub subscription is outside this integration.', 403)
        data = envelope['message']['data'].encode('ascii')
        decoded = base64.b64decode(data + b'=' * (-len(data) % 4), altchars=b'-_', validate=True)
        notification = json.loads(decoded)
        if mailbox(notification['emailAddress']) != settings.gmail_sender:
            raise SignalError('gmail_push_mailbox_mismatch', 'The notification is outside the controlled sender mailbox.', 403)
        return gmail_history_id(notification['historyId'])
    except (AttributeError, KeyError, TypeError, ValueError, binascii.Error):
        raise SignalError('invalid_gmail_push_payload', 'Send a wrapped Gmail Pub/Sub notification.', 400) from None
