from collections import deque
import asyncio
import logging
from contextlib import asynccontextmanager
from threading import Lock
from time import monotonic
from secrets import compare_digest, token_urlsafe
from typing import Annotated

from fastapi import Depends, FastAPI, Request, Response
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import SecretStr
from starlette.concurrency import run_in_threadpool
from starlette.middleware.cors import CORSMiddleware
from starlette.middleware.sessions import SessionMiddleware
from starlette.staticfiles import StaticFiles

from .assistant import AssistantMessage, AssistantReply, answer_workspace
from .config import GMAIL_PUSH_PATH, Settings
from .errors import SignalError
from .gmail_push import GmailPushAuthenticator, gmail_notification
from .models import (
    ApproveIcp, DiscoverInput, EditDraft, GraphInsight, InputModel, IntakeChat, IntakeReply, MoreDiscoveryInput, PipelineChange, ProductInput,
    ReviewDraft, RevisionInput, ScheduleDraft, Workspace,
)
from .providers import Providers
from .research import guide_intake
from .store import Neo4jStore
from .workflow import Workflow


class Login(InputModel):
    password: SecretStr


def error_response(code: str, message: str, status: int) -> JSONResponse:
    return JSONResponse({'error': {'code': code, 'message': message}}, status_code=status)


def require_actor(request: Request) -> str:
    actor = request.session.get('actor')
    if not actor or actor != request.app.state.settings.demo_username:
        raise SignalError('sign_in_required', 'Sign in to open the demo workspace.', 401)
    return actor


Actor = Annotated[str, Depends(require_actor)]


class ChatRateLimit:
    """Caps paid assistant requests per process."""

    def __init__(self, limit: int = 20, window_seconds: float = 600):
        self.limit, self.window = limit, window_seconds
        self.issued: deque[float] = deque()
        self.lock = Lock()

    def take(self) -> None:
        now = monotonic()
        with self.lock:
            while self.issued and now - self.issued[0] > self.window:
                self.issued.popleft()
            if len(self.issued) >= self.limit:
                raise SignalError('chat_rate_limited', 'The assistant is busy. Try again in a few minutes.', 429)
            self.issued.append(now)


def create_app(settings: Settings | None = None, *, store: Neo4jStore | None = None, providers: Providers | None = None) -> FastAPI:
    settings = settings or Settings.load()
    if settings.session_secret and len(settings.session_secret) < 32:
        raise ValueError('SIGNAL_SESSION_SECRET must be at least 32 characters.')
    if settings.demo_username == 'system':
        raise ValueError('SIGNAL_DEMO_USERNAME cannot be the system actor.')
    store = store or Neo4jStore(settings)
    providers = providers or Providers(settings)
    workflow = Workflow(settings, store, providers)
    chat_limit = ChatRateLimit()
    assistant_message_limit = ChatRateLimit(limit=20, window_seconds=60)
    gmail_push = GmailPushAuthenticator(settings, providers.http) if settings.gmail_push_configured else None

    async def refresh_public_signals(stop: asyncio.Event) -> None:
        while not stop.is_set():
            try:
                await asyncio.to_thread(workflow.refresh_research_due)
            except SignalError as error:
                logging.getLogger(__name__).warning('Scheduled research refresh returned %s', error.code)
            try:
                await asyncio.wait_for(stop.wait(), timeout=60)
            except TimeoutError:
                pass

    async def reconcile_gmail(stop: asyncio.Event) -> None:
        while not stop.is_set():
            try:
                await asyncio.to_thread(workflow.reconcile_gmail_watch)
                delay = 15 * 60
            except SignalError as error:
                logging.getLogger(__name__).warning('Scheduled Gmail reconciliation returned %s', error.code)
                delay = 60
            try:
                await asyncio.wait_for(stop.wait(), timeout=delay)
            except TimeoutError:
                pass

    @asynccontextmanager
    async def lifespan(_: FastAPI):
        stop = asyncio.Event()
        refresh = asyncio.create_task(refresh_public_signals(stop)) if settings.research_refresh_minutes else None
        gmail = asyncio.create_task(reconcile_gmail(stop)) if gmail_push else None
        try:
            yield
        finally:
            stop.set()
            if refresh:
                await refresh
            if gmail:
                await gmail
            providers.close()
            store.close()

    app = FastAPI(title='Signal API', version='1.0', docs_url='/api/docs', openapi_url='/api/openapi.json', lifespan=lifespan)
    app.state.settings = settings
    app.add_middleware(
        SessionMiddleware, secret_key=settings.session_secret or token_urlsafe(36), session_cookie='signal_session',
        https_only=settings.public_origin.startswith('https://'), same_site='lax', max_age=8 * 60 * 60,
    )

    @app.middleware('http')
    async def security_headers(request: Request, call_next):
        is_api = request.url.path.startswith('/api/')
        is_authenticated_push_route = request.method == 'POST' and request.url.path == GMAIL_PUSH_PATH
        if (is_api and request.method in ('POST', 'PATCH', 'PUT', 'DELETE') and not is_authenticated_push_route
                and request.headers.get('origin') != settings.public_origin):
            response = error_response('origin_rejected', 'Use the configured demo origin for writes.', 403)
        else:
            response = await call_next(request)
        if is_api:
            response.headers['cache-control'] = 'no-store'
        response.headers['x-content-type-options'] = 'nosniff'
        response.headers['referrer-policy'] = 'no-referrer'
        response.headers['x-frame-options'] = 'DENY'
        return response

    app.add_middleware(
        CORSMiddleware, allow_origins=[settings.public_origin], allow_credentials=True,
        allow_methods=['GET', 'POST', 'PATCH', 'DELETE'], allow_headers=['Content-Type'],
    )

    @app.exception_handler(SignalError)
    async def workflow_error(_: Request, error: SignalError):
        return error_response(error.code, str(error), error.status)

    @app.exception_handler(RequestValidationError)
    async def bad_request(_: Request, error: RequestValidationError):
        # FastAPI's default response can reflect supplied input, including credentials.
        return error_response('validation_error', 'Check the required fields and supported values for this action.', 422)

    @app.get('/api/health')
    def health():
        return {'status': 'ok'}

    @app.post('/api/session')
    def login(body: Login, request: Request):
        if not settings.demo_password or not settings.session_secret:
            raise SignalError('demo_auth_unconfigured', 'Configure the demo password and session secret.', 503)
        if not compare_digest(body.password.get_secret_value().encode(), settings.demo_password.encode()):
            raise SignalError('invalid_password', 'The demo password is incorrect.', 401)
        request.session.clear()
        request.session['actor'] = settings.demo_username
        return {'actor': settings.demo_username}

    @app.get('/api/session')
    def session(actor: Actor):
        return {'actor': actor}

    @app.delete('/api/session', status_code=204)
    def logout(request: Request, actor: Actor):
        request.session.clear()
        return Response(status_code=204)

    @app.get('/api/readiness')
    def readiness(actor: Actor):
        gmail_watch_active, gmail_last_push_at = workflow.gmail_watch_status()
        return {
            'claude_configured': bool(settings.anthropic_api_key), 'tavily_configured': bool(settings.tavily_api_key),
            'hunter_configured': bool(settings.hunter_api_key), 'neo4j_configured': bool(settings.neo4j_uri),
            'neo4j_reachable': store.check(), 'gmail_configured': settings.gmail_configured,
            'gmail_feedback_configured': settings.gmail_feedback_configured,
            'gmail_push_configured': settings.gmail_push_configured, 'gmail_watch_active': gmail_watch_active,
            'gmail_last_push_at': gmail_last_push_at,
            'flexprice_enabled': settings.flexprice_enabled, 'flexprice_configured': settings.flexprice_configured,
            'nexla_configured': bool(settings.nexla_sync_url and settings.nexla_access_token),
            'chat_configured': settings.chat_configured,
        }

    @app.get('/api/workspace')
    def workspace(actor: Actor) -> Workspace:
        return workflow.workspace()

    @app.post('/api/intake/chat')
    def intake_chat(body: IntakeChat, actor: Actor) -> IntakeReply:
        return guide_intake(providers, body)

    @app.post('/api/icp/generate')
    def generate_icp(body: ProductInput, actor: Actor) -> Workspace:
        return workflow.generate_icp(body, actor)

    @app.post('/api/icp/approve')
    def approve_icp(body: ApproveIcp, actor: Actor) -> Workspace:
        return workflow.approve_icp(body, actor)

    @app.post('/api/discover')
    def discover(body: DiscoverInput, actor: Actor) -> Workspace:
        return workflow.discover(body.revision, actor, refresh=body.refresh, deeper_sources=body.deeper_sources)

    @app.post('/api/discover/more')
    def discover_more(body: MoreDiscoveryInput, actor: Actor) -> Workspace:
        return workflow.discover_more(body.revision, actor, body.source_domains)

    @app.post('/api/accounts/{account_id}/enrich')
    def enrich_account(account_id: str, actor: Actor) -> Workspace:
        return workflow.enrich_account(account_id, actor)

    @app.post('/api/accounts/{account_id}/writing-draft')
    def create_writing_draft(account_id: str, actor: Actor) -> Workspace:
        return workflow.create_writing_draft(account_id, actor)

    @app.post('/api/accounts/{account_id}/draft')
    def create_draft(account_id: str, actor: Actor) -> Workspace:
        return workflow.create_draft(account_id, actor)

    @app.get('/api/accounts/{account_id}/insights')
    def graph_insights(account_id: str, actor: Actor) -> list[GraphInsight]:
        return workflow.graph_insights(account_id)

    @app.post('/api/accounts/{account_id}/sequence')
    def create_sequence(account_id: str, actor: Actor) -> Workspace:
        return workflow.create_sequence(account_id, actor)

    @app.patch('/api/drafts/{draft_id}')
    def edit_draft(draft_id: str, body: EditDraft, actor: Actor) -> Workspace:
        return workflow.edit_draft(draft_id, body, actor)

    @app.post('/api/drafts/{draft_id}/review')
    def review_draft(draft_id: str, body: ReviewDraft, actor: Actor) -> Workspace:
        return workflow.review_draft(draft_id, body, actor)

    @app.post('/api/drafts/{draft_id}/send')
    def send_draft(draft_id: str, body: RevisionInput, actor: Actor) -> Workspace:
        return workflow.send_draft(draft_id, body.revision, actor)

    @app.post('/api/chat/message')
    def assistant_message(body: AssistantMessage, actor: Actor) -> AssistantReply:
        assistant_message_limit.take()
        return answer_workspace(providers, workflow.workspace(), body)

    @app.post('/api/chat/session')
    def chat_session(actor: Actor):
        # The assistant is read-only: its only tool runs in the browser on data the UI already shows.
        if not settings.chat_configured:
            raise SignalError('chat_unconfigured', 'Configure ELEVENLABS_API_KEY and ELEVENLABS_AGENT_ID.', 503)
        chat_limit.take()
        return {'signed_url': providers.chat_signed_url()}
    @app.post('/api/drafts/{draft_id}/schedule')
    def schedule_draft(draft_id: str, body: ScheduleDraft, actor: Actor) -> Workspace:
        return workflow.schedule_draft(draft_id, body, actor)

    @app.post('/api/drafts/{draft_id}/linkedin-handoff')
    def prepare_linkedin(draft_id: str, body: RevisionInput, actor: Actor) -> Workspace:
        return workflow.prepare_linkedin(draft_id, body.revision, actor)

    @app.post('/api/pipeline/{account_id}/stage')
    def move_pipeline(account_id: str, body: PipelineChange, actor: Actor) -> Workspace:
        return workflow.change_pipeline(account_id, body, actor)

    @app.post('/api/feedback/gmail/sync')
    def gmail_feedback(actor: Actor) -> Workspace:
        return workflow.sync_gmail_feedback()

    @app.post(GMAIL_PUSH_PATH, status_code=204, include_in_schema=False)
    async def gmail_webhook(request: Request) -> Response:
        if not gmail_push:
            raise SignalError('gmail_push_unconfigured', 'Configure Gmail Pub/Sub push to receive notifications.', 503)
        await run_in_threadpool(gmail_push.authorize, request.headers.get('authorization', ''))
        history_id = await gmail_notification(request, settings)
        await run_in_threadpool(workflow.process_gmail_notification, history_id)
        return Response(status_code=204)

    if settings.static_dir.is_dir():
        app.mount('/', StaticFiles(directory=settings.static_dir, html=True), name='workspace-ui')

    return app


app = create_app()
