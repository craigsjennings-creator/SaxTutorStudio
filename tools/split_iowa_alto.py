"""
Split University of Iowa grouped Alto Sax AIFF recordings into individual WAV notes.

Expected source files:
    AltoSax.NoVib.mf.Db3B3.aiff
    AltoSax.NoVib.mf.C4B4.aiff
    AltoSax.NoVib.mf.C5Ab5.aiff

Usage from the SaxTutorStudio project root:

    python tools/split_iowa_alto.py

Optional:
    python tools/split_iowa_alto.py --source frontend/static/audio/saxophone/alto/mf
    python tools/split_iowa_alto.py --output frontend/static/audio/saxophone/alto/samples/mf

Dependencies:
    pip install numpy soundfile

The script:
- keeps the original AIFF files untouched
- detects note regions from the silence between notes
- verifies the expected number of notes for each Iowa file
- exports browser-friendly 44.1 kHz mono WAV files
- adds a small amount of silence before/after each note so attacks/releases are not clipped
- writes a split_report.txt file showing exactly what was exported

No pitch shifting or normalization is applied.
"""

from __future__ import annotations

import argparse
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

import numpy as np
import soundfile as sf


DEFAULT_SOURCE = Path("frontend/static/audio/saxophone/alto/mf")
DEFAULT_OUTPUT = Path("frontend/static/audio/saxophone/alto/samples/mf")

NOTE_MAP = {
    "AltoSax.NoVib.mf.Db3B3.aiff": [
        "Db3", "D3", "Eb3", "E3", "F3", "Gb3",
        "G3", "Ab3", "A3", "Bb3", "B3",
    ],
    "AltoSax.NoVib.mf.C4B4.aiff": [
        "C4", "Db4", "D4", "Eb4", "E4", "F4",
        "Gb4", "G4", "Ab4", "A4", "Bb4", "B4",
    ],
    "AltoSax.NoVib.mf.C5Ab5.aiff": [
        "C5", "Db5", "D5", "Eb5", "E5",
        "F5", "Gb5", "G5", "Ab5",
    ],
}


@dataclass
class Region:
    start: int
    end: int

    @property
    def length(self) -> int:
        return self.end - self.start


def to_mono(audio: np.ndarray) -> np.ndarray:
    if audio.ndim == 1:
        return audio.astype(np.float32, copy=False)
    return np.mean(audio, axis=1, dtype=np.float32)


def frame_rms(audio: np.ndarray, frame_size: int, hop_size: int) -> np.ndarray:
    if len(audio) < frame_size:
        padded = np.pad(audio, (0, frame_size - len(audio)))
        return np.array([np.sqrt(np.mean(padded * padded) + 1e-12)], dtype=np.float32)

    count = 1 + (len(audio) - frame_size) // hop_size
    rms = np.empty(count, dtype=np.float32)

    for i in range(count):
        start = i * hop_size
        frame = audio[start:start + frame_size]
        rms[i] = np.sqrt(np.mean(frame * frame) + 1e-12)

    return rms


def mask_to_regions(
    active: np.ndarray,
    hop_size: int,
    audio_length: int,
    min_note_samples: int,
    merge_gap_samples: int,
) -> list[Region]:
    raw: list[Region] = []
    start_frame = None

    for i, value in enumerate(active):
        if value and start_frame is None:
            start_frame = i
        elif not value and start_frame is not None:
            start = start_frame * hop_size
            end = min(audio_length, i * hop_size)
            raw.append(Region(start, end))
            start_frame = None

    if start_frame is not None:
        raw.append(Region(start_frame * hop_size, audio_length))

    if not raw:
        return []

    merged = [raw[0]]

    for region in raw[1:]:
        gap = region.start - merged[-1].end
        if gap <= merge_gap_samples:
            merged[-1].end = region.end
        else:
            merged.append(region)

    return [region for region in merged if region.length >= min_note_samples]


def detect_regions(
    audio: np.ndarray,
    sample_rate: int,
    expected_count: int,
) -> tuple[list[Region], dict]:
    """
    Search several sensible thresholds/gap sizes and choose the result
    that exactly matches the expected number of notes where possible.
    """
    frame_ms = 20
    hop_ms = 10

    frame_size = max(1, int(sample_rate * frame_ms / 1000))
    hop_size = max(1, int(sample_rate * hop_ms / 1000))

    rms = frame_rms(audio, frame_size, hop_size)
    peak = float(np.max(rms))

    if peak <= 1e-8:
        raise RuntimeError("The source audio appears to be silent.")

    min_note_samples = int(sample_rate * 0.18)

    candidates: list[tuple[int, float, float, list[Region], dict]] = []

    # Thresholds are relative to peak RMS.
    for db_below_peak in range(24, 55, 2):
        threshold = peak * (10 ** (-db_below_peak / 20.0))
        active = rms >= threshold

        for merge_gap_ms in (40, 60, 80, 100, 120, 150, 180, 220):
            regions = mask_to_regions(
                active=active,
                hop_size=hop_size,
                audio_length=len(audio),
                min_note_samples=min_note_samples,
                merge_gap_samples=int(sample_rate * merge_gap_ms / 1000),
            )

            difference = abs(len(regions) - expected_count)

            # Prefer exact count, then a threshold around -36 dB,
            # then moderate gap merging.
            preference = abs(db_below_peak - 36) + abs(merge_gap_ms - 100) / 25

            meta = {
                "db_below_peak": db_below_peak,
                "threshold": threshold,
                "merge_gap_ms": merge_gap_ms,
                "detected_count": len(regions),
            }

            candidates.append(
                (difference, preference, -db_below_peak, regions, meta)
            )

    candidates.sort(key=lambda item: (item[0], item[1], item[2]))

    best = candidates[0]
    return best[3], best[4]


def expand_region(
    region: Region,
    sample_rate: int,
    audio_length: int,
    pre_ms: int = 25,
    post_ms: int = 120,
) -> Region:
    pre = int(sample_rate * pre_ms / 1000)
    post = int(sample_rate * post_ms / 1000)

    return Region(
        max(0, region.start - pre),
        min(audio_length, region.end + post),
    )


def export_file(source_file: Path, note_names: list[str], output_dir: Path) -> list[str]:
    audio, sample_rate = sf.read(source_file, always_2d=False, dtype="float32")
    mono = to_mono(audio)

    regions, detection = detect_regions(
        mono,
        sample_rate,
        expected_count=len(note_names),
    )

    print(
        f"{source_file.name}: detected {len(regions)} regions "
        f"(expected {len(note_names)}), "
        f"threshold -{detection['db_below_peak']} dB, "
        f"merge gap {detection['merge_gap_ms']} ms"
    )

    if len(regions) != len(note_names):
        raise RuntimeError(
            f"\nCould not confidently split {source_file.name}.\n"
            f"Expected {len(note_names)} notes but detected {len(regions)}.\n\n"
            "Nothing from this file has been exported.\n"
            "Send me the console output and we can tune the detector for the Iowa recording."
        )

    report_lines: list[str] = []

    for note_name, region in zip(note_names, regions):
        padded = expand_region(region, sample_rate, len(mono))
        clip = mono[padded.start:padded.end]

        destination = output_dir / f"{note_name}.wav"

        sf.write(
            destination,
            clip,
            sample_rate,
            subtype="PCM_16",
            format="WAV",
        )

        duration = len(clip) / sample_rate
        report_lines.append(
            f"{destination.name:<8} "
            f"{duration:>6.2f}s   "
            f"source={source_file.name}"
        )

    return report_lines


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Split Iowa Alto Sax grouped AIFF files into individual WAV samples."
    )
    parser.add_argument(
        "--source",
        type=Path,
        default=DEFAULT_SOURCE,
        help=f"Folder containing Iowa AIFF files (default: {DEFAULT_SOURCE})",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=DEFAULT_OUTPUT,
        help=f"Folder for individual WAV notes (default: {DEFAULT_OUTPUT})",
    )

    args = parser.parse_args()

    source_dir: Path = args.source
    output_dir: Path = args.output

    if not source_dir.exists():
        raise SystemExit(
            f"Source folder not found:\n  {source_dir.resolve()}\n\n"
            "Run this command from the SaxTutorStudio project root."
        )

    missing = [
        filename
        for filename in NOTE_MAP
        if not (source_dir / filename).exists()
    ]

    if missing:
        raise SystemExit(
            "Missing Iowa source file(s):\n  "
            + "\n  ".join(missing)
        )

    output_dir.mkdir(parents=True, exist_ok=True)

    print("\nYourMusicTutorial - Iowa Alto Sax Sample Splitter")
    print("=" * 54)
    print(f"Source: {source_dir.resolve()}")
    print(f"Output: {output_dir.resolve()}\n")

    all_report_lines: list[str] = []

    for filename, note_names in NOTE_MAP.items():
        lines = export_file(
            source_dir / filename,
            note_names,
            output_dir,
        )
        all_report_lines.extend(lines)

    report_path = output_dir / "split_report.txt"

    report_text = (
        "YourMusicTutorial - Iowa Alto Sax mf sample split report\n"
        + "=" * 58
        + "\n\n"
        + "\n".join(all_report_lines)
        + f"\n\nTotal samples: {len(all_report_lines)}\n"
    )

    report_path.write_text(report_text, encoding="utf-8")

    print("\n" + "=" * 54)
    print(f"Success: exported {len(all_report_lines)} individual WAV samples.")
    print(f"Report: {report_path.resolve()}")
    print("\nDo not delete the original Iowa AIFF files.")


if __name__ == "__main__":
    main()
