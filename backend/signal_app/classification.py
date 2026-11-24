import json
from functools import lru_cache
from pathlib import Path

from .errors import SignalError
from .models import IndustryCode


CATALOG_DIRECTORY = Path(__file__).with_name('data')


@lru_cache(maxsize=2)
def catalog(system: str) -> dict[str, str]:
    if system == 'NAICS':
        return json.loads((CATALOG_DIRECTORY / 'naics-2022.json').read_text())
    if system == 'SIC':
        return json.loads((CATALOG_DIRECTORY / 'sic-edgar.json').read_text())
    raise KeyError(system)


def validate_codes(codes: list[IndustryCode], *, strict: bool = False) -> list[IndustryCode]:
    validated = {}
    for entry in codes:
        code = entry.code.zfill(4) if entry.system == 'SIC' else entry.code
        title = catalog(entry.system).get(code)
        if title:
            validated[entry.system, code] = IndustryCode(system=entry.system, code=code, title=title)
        elif strict:
            raise SignalError('unknown_industry_code', f'{entry.system} {code} was not found in the official catalog.', 422)
    return list(validated.values())
