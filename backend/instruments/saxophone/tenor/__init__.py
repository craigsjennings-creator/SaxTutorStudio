from dataclasses import dataclass


@dataclass(frozen=True)
class TenorSaxophone:
    """Tenor saxophone instrument definition."""

    name: str = "Tenor Saxophone"
    family: str = "Saxophone"
    transposition: str = "Bb"