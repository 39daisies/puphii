"""Synthesises Puphii's bubble sounds from scratch (no samples, no third-party audio).

Usage: python3 scripts/generate-bubble-sounds.py [output_dir]

The app ships "bubble-bloop" as assets/sounds/bubble-bloop.wav; the others are
alternatives that were auditioned and are not bundled.

A real bubble rings near its resonant frequency and the pitch rises as it shrinks
and surfaces, so each "bubble" here is a decaying sine with an upward pitch glide.
"""

import math
import os
import random
import struct
import sys
import wave

RATE = 44100


def bubble(start_hz, end_hz, length_s, decay_s, gain=1.0, delay_s=0.0):
    """Returns (delay_samples, samples) for one bubble."""
    n = int(length_s * RATE)
    attack = int(0.002 * RATE)
    phase = 0.0
    out = []
    for i in range(n):
        t = i / RATE
        progress = i / n
        # Ease-out glide so the pitch rises quickly, then settles.
        freq = start_hz + (end_hz - start_hz) * (1 - (1 - progress) ** 2)
        phase += 2 * math.pi * freq / RATE
        env = math.exp(-t / decay_s)
        if i < attack:
            env *= i / attack
        tail = min(1.0, (n - i) / (0.01 * RATE))
        # A quiet second harmonic gives a rounder, wetter tone than a bare sine.
        out.append(gain * env * tail * (math.sin(phase) + 0.18 * math.sin(2 * phase)))
    return int(delay_s * RATE), out


def mix(*bubbles):
    total = max(delay + len(samples) for delay, samples in bubbles)
    buf = [0.0] * total
    for delay, samples in bubbles:
        for i, value in enumerate(samples):
            buf[delay + i] += value
    return buf


def write_wav(path, samples, peak=0.6):
    top = max(abs(s) for s in samples) or 1.0
    scale = peak / top
    with wave.open(path, "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(RATE)
        wav.writeframes(b"".join(struct.pack("<h", int(max(-1, min(1, s * scale)) * 32767)) for s in samples))


def sounds():
    rng = random.Random(7)
    fizz = [bubble(rng.uniform(900, 1300), rng.uniform(1600, 2200), 0.05, 0.018, 0.6, i * 0.035) for i in range(4)]
    return {
        "bubble-bloop": mix(bubble(320, 760, 0.16, 0.06)),
        "bubble-plip": mix(bubble(950, 1900, 0.07, 0.022)),
        "bubble-double": mix(bubble(480, 980, 0.09, 0.03), bubble(650, 1300, 0.09, 0.028, 0.8, 0.07)),
        "bubble-gulp": mix(bubble(220, 520, 0.2, 0.08), bubble(600, 1150, 0.06, 0.02, 0.45, 0.11)),
        "bubble-fizz": mix(*fizz),
    }


if __name__ == "__main__":
    out_dir = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(__file__), "..", "assets", "sounds", "options")
    os.makedirs(out_dir, exist_ok=True)
    for name, samples in sounds().items():
        path = os.path.join(out_dir, f"{name}.wav")
        write_wav(path, samples)
        print(f"{path}  {len(samples) / RATE * 1000:.0f} ms")
