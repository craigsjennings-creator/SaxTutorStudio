/*
 * YourMusicTutorial - Listen & Score Lab v1
 *
 * Standalone prototype.
 * It analyses the known Iowa Alto Sax WAV files already in:
 *
 * /static/audio/saxophone/alto/samples/mf/
 *
 * The pitch detector uses a YIN-style cumulative mean
 * normalized difference function across several steady-state
 * windows of each sample, then takes the median result.
 */

const SAMPLE_BASE =
    "/static/audio/saxophone/alto/samples/mf/";

const SAMPLE_NOTES = [
    "Db3", "D3", "Eb3", "E3", "F3", "Gb3",
    "G3", "Ab3", "A3", "Bb3", "B3",
    "C4", "Db4", "D4", "Eb4", "E4", "F4",
    "Gb4", "G4", "Ab4", "A4", "Bb4", "B4",
    "C5", "Db5", "D5", "Eb5", "E5", "F5",
    "Gb5", "G5", "Ab5"
];

let audioContext = null;


function ensureAudioContext() {

    if (!audioContext) {
        const AudioContextClass =
            window.AudioContext ||
            window.webkitAudioContext;

        audioContext =
            new AudioContextClass();
    }

    if (audioContext.state === "suspended") {
        audioContext.resume();
    }
}


function populateSelectors() {

    const sampleSelect =
        document.getElementById("sample-note");

    const expectedSelect =
        document.getElementById("expected-note");

    SAMPLE_NOTES.forEach(note => {

        const sampleOption =
            document.createElement("option");

        sampleOption.value = note;
        sampleOption.textContent = `${note}.wav`;

        sampleSelect.appendChild(
            sampleOption
        );

        const expectedOption =
            document.createElement("option");

        expectedOption.value = note;
        expectedOption.textContent = note;

        expectedSelect.appendChild(
            expectedOption
        );
    });

    sampleSelect.value = "C4";
    expectedSelect.value = "C4";

    /*
     * Convenience: changing the sample automatically changes
     * expected note too. The user can then deliberately change
     * Expected to test a wrong-note result.
     */
    sampleSelect.addEventListener(
        "change",
        () => {
            expectedSelect.value =
                sampleSelect.value;
        }
    );
}


async function loadSample(noteName) {

    ensureAudioContext();

    const response =
        await fetch(
            `${SAMPLE_BASE}${noteName}.wav`
        );

    if (!response.ok) {
        throw new Error(
            `Could not load ${noteName}.wav (HTTP ${response.status})`
        );
    }

    const bytes =
        await response.arrayBuffer();

    return await audioContext.decodeAudioData(
        bytes
    );
}


function toMono(buffer) {

    if (buffer.numberOfChannels === 1) {
        return buffer.getChannelData(0);
    }

    const length = buffer.length;
    const mono = new Float32Array(length);

    for (
        let channel = 0;
        channel < buffer.numberOfChannels;
        channel++
    ) {

        const data =
            buffer.getChannelData(channel);

        for (let i = 0; i < length; i++) {
            mono[i] +=
                data[i] /
                buffer.numberOfChannels;
        }
    }

    return mono;
}


function rms(frame) {

    let sum = 0;

    for (let i = 0; i < frame.length; i++) {
        sum += frame[i] * frame[i];
    }

    return Math.sqrt(
        sum / frame.length
    );
}


function yinPitch(
    frame,
    sampleRate
) {

    /*
     * Our Iowa Alto bank covers approximately Db3-Ab5.
     * Search slightly wider so later microphone input has room.
     */
    const minFrequency = 90;
    const maxFrequency = 1000;

    const minTau =
        Math.max(
            2,
            Math.floor(
                sampleRate /
                maxFrequency
            )
        );

    const maxTau =
        Math.min(
            Math.floor(
                sampleRate /
                minFrequency
            ),
            Math.floor(
                frame.length / 2
            )
        );

    const difference =
        new Float64Array(
            maxTau + 1
        );

    for (
        let tau = 1;
        tau <= maxTau;
        tau++
    ) {

        let sum = 0;

        const limit =
            frame.length - tau;

        for (
            let i = 0;
            i < limit;
            i++
        ) {

            const delta =
                frame[i] -
                frame[i + tau];

            sum += delta * delta;
        }

        difference[tau] = sum;
    }

    const cmnd =
        new Float64Array(
            maxTau + 1
        );

    cmnd[0] = 1;

    let runningSum = 0;

    for (
        let tau = 1;
        tau <= maxTau;
        tau++
    ) {

        runningSum +=
            difference[tau];

        cmnd[tau] =
            runningSum === 0
                ? 1
                : (
                    difference[tau] *
                    tau /
                    runningSum
                );
    }

    /*
     * Prefer the first strong YIN minimum.
     */
    const threshold = 0.15;
    let tauEstimate = -1;

    for (
        let tau = minTau;
        tau < maxTau;
        tau++
    ) {

        if (cmnd[tau] < threshold) {

            while (
                tau + 1 <= maxTau &&
                cmnd[tau + 1] <
                cmnd[tau]
            ) {
                tau++;
            }

            tauEstimate = tau;
            break;
        }
    }

    /*
     * If no threshold crossing exists, fall back to the
     * global minimum in the valid range.
     */
    if (tauEstimate < 0) {

        let bestValue = Infinity;

        for (
            let tau = minTau;
            tau <= maxTau;
            tau++
        ) {

            if (cmnd[tau] < bestValue) {
                bestValue =
                    cmnd[tau];

                tauEstimate =
                    tau;
            }
        }
    }

    if (tauEstimate <= 0) {
        return null;
    }

    /*
     * Parabolic interpolation around the minimum.
     */
    let betterTau =
        tauEstimate;

    if (
        tauEstimate > minTau &&
        tauEstimate < maxTau
    ) {

        const left =
            cmnd[tauEstimate - 1];

        const centre =
            cmnd[tauEstimate];

        const right =
            cmnd[tauEstimate + 1];

        const denominator =
            (2 * centre) -
            left -
            right;

        if (
            Math.abs(denominator) >
            1e-12
        ) {

            betterTau =
                tauEstimate +
                0.5 *
                (right - left) /
                denominator;
        }
    }

    const frequency =
        sampleRate /
        betterTau;

    const confidence =
        Math.max(
            0,
            Math.min(
                1,
                1 - cmnd[tauEstimate]
            )
        );

    return {
        frequency,
        confidence
    };
}


function median(values) {

    const sorted =
        [...values].sort(
            (a, b) => a - b
        );

    const middle =
        Math.floor(
            sorted.length / 2
        );

    if (
        sorted.length % 2 === 0
    ) {
        return (
            sorted[middle - 1] +
            sorted[middle]
        ) / 2;
    }

    return sorted[middle];
}


function analyseBuffer(buffer) {

    const mono =
        toMono(buffer);

    const sampleRate =
        buffer.sampleRate;

    /*
     * Use steady-state regions rather than the attack.
     * 4096 samples is ~93ms at 44.1 kHz.
     */
    const frameSize = 4096;

    const fractions = [
        0.18,
        0.28,
        0.38,
        0.48,
        0.58,
        0.68
    ];

    const results = [];

    fractions.forEach(fraction => {

        const centre =
            Math.floor(
                mono.length *
                fraction
            );

        const start =
            Math.max(
                0,
                Math.min(
                    mono.length -
                    frameSize,
                    centre -
                    Math.floor(
                        frameSize / 2
                    )
                )
            );

        const frame =
            mono.subarray(
                start,
                start + frameSize
            );

        /*
         * Ignore very quiet sections.
         */
        if (rms(frame) < 0.003) {
            return;
        }

        const result =
            yinPitch(
                frame,
                sampleRate
            );

        if (
            result &&
            Number.isFinite(
                result.frequency
            )
        ) {
            results.push(result);
        }
    });

    if (!results.length) {
        throw new Error(
            "No stable pitched region was detected."
        );
    }

    /*
     * Discard obvious octave/outlier frames using the median.
     */
    const roughMedian =
        median(
            results.map(
                result =>
                    result.frequency
            )
        );

    const filtered =
        results.filter(result => {

            const ratio =
                result.frequency /
                roughMedian;

            return (
                ratio > 0.80 &&
                ratio < 1.20
            );
        });

    const usable =
        filtered.length
            ? filtered
            : results;

    return {
        frequency:
            median(
                usable.map(
                    result =>
                        result.frequency
                )
            ),

        confidence:
            median(
                usable.map(
                    result =>
                        result.confidence
                )
            ),

        frames:
            usable.length
    };
}


function frequencyToMidi(
    frequency
) {

    return (
        69 +
        12 *
        Math.log2(
            frequency / 440
        )
    );
}


function midiToFrequency(midi) {

    return (
        440 *
        Math.pow(
            2,
            (midi - 69) / 12
        )
    );
}


function midiToNoteName(midi) {

    const names = [
        "C", "Db", "D", "Eb",
        "E", "F", "Gb", "G",
        "Ab", "A", "Bb", "B"
    ];

    const rounded =
        Math.round(midi);

    const pitchClass =
        (
            (rounded % 12) + 12
        ) % 12;

    const octave =
        Math.floor(
            rounded / 12
        ) - 1;

    return (
        names[pitchClass] +
        octave
    );
}


function noteNameToMidi(noteName) {

    const match =
        String(noteName).match(
            /^([A-G])([b#]?)(-?\d+)$/
        );

    if (!match) {
        return null;
    }

    const [, letter, accidental, octaveText] =
        match;

    const base = {
        C: 0,
        D: 2,
        E: 4,
        F: 5,
        G: 7,
        A: 9,
        B: 11
    }[letter];

    let semitone = base;

    if (accidental === "#") {
        semitone += 1;
    } else if (accidental === "b") {
        semitone -= 1;
    }

    const octave =
        parseInt(
            octaveText,
            10
        );

    return (
        (octave + 1) * 12 +
        semitone
    );
}


function calculateScore(
    expectedNote,
    frequency,
    confidence
) {

    const expectedMidi =
        noteNameToMidi(
            expectedNote
        );

    const detectedMidiFloat =
        frequencyToMidi(
            frequency
        );

    const detectedMidi =
        Math.round(
            detectedMidiFloat
        );

    const detectedNote =
        midiToNoteName(
            detectedMidi
        );

    const expectedFrequency =
        midiToFrequency(
            expectedMidi
        );

    /*
     * Signed cents relative to the EXPECTED note.
     * This makes wrong semitones show roughly +/-100 cents,
     * not merely their tuning error relative to themselves.
     */
    const centsFromExpected =
        1200 *
        Math.log2(
            frequency /
            expectedFrequency
        );

    const exactNoteMatch =
        detectedMidi ===
        expectedMidi;

    /*
     * Pitch score:
     * <= 5 cents   = 100
     * 25 cents     ~= 85
     * 50 cents     ~= 65
     * 100 cents    ~= 25
     *
     * Wrong-note results are capped below a pass-like score.
     */
    const absoluteCents =
        Math.abs(
            centsFromExpected
        );

    let pitchScore;

    if (absoluteCents <= 5) {
        pitchScore = 100;
    } else {
        pitchScore =
            Math.max(
                0,
                100 -
                (
                    absoluteCents - 5
                ) * 0.8
            );
    }

    if (!exactNoteMatch) {
        pitchScore =
            Math.min(
                pitchScore,
                45
            );
    }

    /*
     * Confidence only has a modest effect.
     * Later we should avoid scoring frames at all when
     * confidence is too low rather than blaming the player.
     */
    const confidenceFactor =
        0.85 +
        (
            Math.max(
                0,
                Math.min(
                    1,
                    confidence
                )
            ) *
            0.15
        );

    const overallScore =
        Math.round(
            pitchScore *
            confidenceFactor
        );

    return {
        overallScore,
        detectedNote,
        centsFromExpected,
        exactNoteMatch
    };
}


function scoreClass(score) {

    if (score >= 85) {
        return "good";
    }

    if (score >= 60) {
        return "warn";
    }

    return "bad";
}


async function runAnalysis() {

    const button =
        document.getElementById(
            "analyse-button"
        );

    const status =
        document.getElementById(
            "status"
        );

    const resultCard =
        document.getElementById(
            "result"
        );

    const sampleNote =
        document.getElementById(
            "sample-note"
        ).value;

    const expectedNote =
        document.getElementById(
            "expected-note"
        ).value;

    button.disabled = true;
    button.textContent =
        "Analysing...";

    status.textContent =
        `Loading ${sampleNote}.wav...`;

    try {

        const buffer =
            await loadSample(
                sampleNote
            );

        status.textContent =
            "Detecting pitch...";

        /*
         * Yield a frame so the UI can repaint before
         * the CPU-heavy YIN work.
         */
        await new Promise(
            resolve =>
                requestAnimationFrame(
                    resolve
                )
        );

        const analysis =
            analyseBuffer(
                buffer
            );

        const score =
            calculateScore(
                expectedNote,
                analysis.frequency,
                analysis.confidence
            );

        const scoreElement =
            document.getElementById(
                "score"
            );

        scoreElement.className =
            `score ${scoreClass(
                score.overallScore
            )}`;

        scoreElement.textContent =
            `${score.overallScore}%`;

        document.getElementById(
            "expected-result"
        ).textContent =
            expectedNote;

        document.getElementById(
            "detected-result"
        ).textContent =
            score.detectedNote;

        document.getElementById(
            "frequency-result"
        ).textContent =
            `${analysis.frequency.toFixed(
                2
            )} Hz`;

        const cents =
            score.centsFromExpected;

        document.getElementById(
            "cents-result"
        ).textContent =
            `${
                cents >= 0 ? "+" : ""
            }${cents.toFixed(1)} cents`;

        document.getElementById(
            "confidence-result"
        ).textContent =
            `${Math.round(
                analysis.confidence *
                100
            )}%`;

        const match =
            document.getElementById(
                "match-result"
            );

        match.textContent =
            score.exactNoteMatch
                ? "✓ Correct note"
                : "✗ Wrong note";

        match.className =
            `metric-value ${
                score.exactNoteMatch
                    ? "good"
                    : "bad"
            }`;

        resultCard.style.display =
            "block";

        status.textContent =
            `Analysed ${analysis.frames} steady-state frames from ${sampleNote}.wav.`;

    } catch (error) {

        console.error(error);

        status.textContent =
            `Error: ${error.message}`;

    } finally {

        button.disabled = false;
        button.textContent =
            "Analyse Sample";
    }
}


document.addEventListener(
    "DOMContentLoaded",
    () => {

        populateSelectors();

        document
            .getElementById(
                "analyse-button"
            )
            .addEventListener(
                "click",
                runAnalysis
            );
    }
);
