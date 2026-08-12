from dataclasses import dataclass


@dataclass(frozen=True)
class AltoSaxophone:
    """Alto saxophone instrument definition."""

    name: str = "Alto Saxophone"
    family: str = "Saxophone"
    transposition: str = "Eb"