#!/usr/bin/env python3
"""Check bundled runtime references and ordinary Git file-size thresholds."""

import json
import math
from pathlib import Path
import sys
import wave

ROOT = Path(__file__).resolve().parents[1]
MIB = 1024 * 1024


def asset(base, relative):
    if not isinstance(relative, str) or not relative:
        raise ValueError(f"Missing asset path under {base.relative_to(ROOT)}")
    path = (base / relative).resolve()
    if not path.is_relative_to(base.resolve()):
        raise ValueError(f"Asset escapes its directory: {relative}")
    if not path.is_file():
        raise ValueError(f"Missing asset: {path.relative_to(ROOT)}")
    return path


def check():
    referenced = set()
    for name in ("spring1", "spring"):
        base = ROOT / "marble-scenes" / name
        scene_files = {
            asset(base, "3d/gaussian.compressed.ply"),
            asset(base, "render_cfg/choice.json"),
        }
        sources = json.loads((base / "render_cfg/choice.json").read_text())
        if name == "spring":
            if len(sources) != 14:
                raise ValueError("ELD Visualization must retain its 14 weighted geometries")
            if any("audio_path" in source or "grain_path" in source for source in sources):
                raise ValueError("ELD Visualization must not reference audio or grains")
        grain_count = 0
        grain_sources = 0
        audio_sources = 0
        dictionaries = set()
        for source in sources:
            if source.get("audio_path"):
                audio_sources += 1
                scene_files.add(asset(base / "audio", source["audio_path"]))
            elif source.get("grain_path"):
                raise ValueError("Grain rendering requires audio_path for loop comparison")
            for key in ("pcd", "pcd_points", "pcd_points_down", "pcd_weights"):
                if source.get(key):
                    scene_files.add(asset(base / "render_cfg", source[key]))
            if not source.get("grain_path"):
                continue
            grain_sources += 1
            dictionary_path = asset(base / "sound-grains", source["grain_path"] + "/dictionary.json")
            if dictionary_path in dictionaries:
                continue
            dictionaries.add(dictionary_path)
            grain_root = dictionary_path.parent
            rate_path = asset(grain_root, "rate.json")
            scene_files.update((dictionary_path, rate_path))
            dictionary = json.loads(dictionary_path.read_text())
            if dictionary["format"] != "sound-grain-dictionary" or dictionary["version"] != 1:
                raise ValueError(f"Unsupported dictionary: {dictionary_path}")
            rate = json.loads(rate_path.read_text())["poisson_rate"]
            if not isinstance(rate, (int, float)) or not 0 < rate <= 100:
                raise ValueError(f"Invalid bundled grain rate: {rate}")
            grains = dictionary["grains"]
            if not grains or len(grains) != dictionary["grain_count"]:
                raise ValueError(f"Grain count mismatch: {dictionary_path}")
            grain_count += len(grains)
            for grain in grains.values():
                wav_path = asset(grain_root, grain["path"])
                with wave.open(str(wav_path)) as wav:
                    if wav.getsampwidth() != 2 or wav.getnframes() == 0:
                        raise ValueError(f"Invalid PCM grain: {wav_path}")
                    if wav.getframerate() != grain["sample_rate"] or wav.getnchannels() != grain["channels"]:
                        raise ValueError(f"Grain format differs from dictionary: {wav_path}")
                scene_files.add(wav_path)
            profile_path = asset(grain_root, dictionary["noise_profile"]["path"])
            profile = json.loads(profile_path.read_text())
            if profile["format"] != "sound-grain-noise-profile" or profile["version"] != 1:
                raise ValueError(f"Invalid noise profile: {profile_path}")
            powers = profile["noise_power_by_channel"]
            if len(powers) != profile["channels"] or any(
                len(channel) != profile["fft_size"] // 2 + 1 or
                any(not math.isfinite(v) or v < 0 for v in channel) for channel in powers
            ):
                raise ValueError(f"Invalid noise spectrum: {profile_path}")
            scene_files.add(profile_path)
        referenced.update(scene_files)
        size = sum(path.stat().st_size for path in scene_files)
        if name == "spring1" and (len(sources) != 1 or grain_sources != 1 or grain_count != 183):
            raise ValueError("Grain Rendering must keep its one source and 183 grains")
        print(f"{name}: {audio_sources} audio sources, {len(sources) - audio_sources} ELD-only geometries, "
              f"{grain_count} grains in {len(dictionaries)} libraries, "
              f"{len(scene_files)} files, {size / MIB:.2f} MiB")
    bundled = {p.resolve() for p in (ROOT / "marble-scenes").rglob("*") if p.is_file()}
    extra = bundled - referenced
    if extra:
        raise ValueError(f"Unreferenced scene files: {sorted(str(p.relative_to(ROOT)) for p in extra)}")
    for path in sorted(referenced):
        size = path.stat().st_size
        if size > 100 * MIB:
            raise ValueError(f"Exceeds GitHub's 100 MiB file limit: {path.relative_to(ROOT)}")
        if size > 50 * MIB:
            print(f"Warning: above 50 MiB: {path.relative_to(ROOT)}")
    largest = max(referenced, key=lambda path: path.stat().st_size)
    print(f"Largest asset: {largest.stat().st_size / MIB:.2f} MiB")
    print("All bundled runtime references are present and contained in this repository.")


if __name__ == "__main__":
    try:
        check()
    except (ValueError, KeyError, OSError) as error:
        print(f"Asset check failed: {error}", file=sys.stderr)
        sys.exit(1)
