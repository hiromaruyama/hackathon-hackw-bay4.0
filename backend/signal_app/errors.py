class SignalError(Exception):
    def __init__(self, code: str, message: str, status: int = 409):
        super().__init__(message)
        self.code = code
        self.status = status


class ProviderError(SignalError):
    def __init__(self, provider: str, detail: str = 'did not return a usable response.', status: int = 502):
        self.provider = provider
        super().__init__(f'{provider.lower()}_unavailable', f'{provider} {detail}', status)
