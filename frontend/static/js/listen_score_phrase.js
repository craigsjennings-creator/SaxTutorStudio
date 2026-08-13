/*
 * YourMusicTutorial - Multi-note Listen & Score v1
 *
 * Uses known Iowa Alto Sax samples to simulate a player's phrase.
 * This validates phrase-level note scoring before live microphone input.
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

/*
 * A simple five-note beginner phrase.
 * Later this will come directly from tutorialNotes.
 */
const EXPECTED_PHRASE = [
    "C4",
    "D4",
    "E4",
    "F4",
    "G4",
    "F4",
    "E4",
    "D4",
    "C4"
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


function buildPhraseUI() {

    const grid =
        document.getElementById(
            "phrase-grid"
        );

    EXPECTED_PHRASE.forEach(
        (expectedNote, index) => {

            const row =
                document.createElement("div");

            row.className =
                "phrase-row";

            row.innerHTML = `
                <div class="num">
                    ${index + 1}
                </div>

                <div class="expected">
                    ${expectedNote}
                </div>

                <select
                    class="played-select"
                    data-index="${index}"
                ></select>
            `;

            const select =
                row.querySelector(
                    "select"
                );

            SAMPLE_NOTES.forEach(note => {

                const option =
                    document.createElement(
                        "option"
                    );

                option.value = note;
                option.textContent =
                    `${note}.wav`;

                select.appendChild(option);
            });

            select.value =
                expectedNote;

            grid.appendChild(row);
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

    const mono =
        new Float32Array(
            buffer.length
        );

    for (
        let channel = 0;
        channel < buffer.numberOfChannels;
        channel++
    ) {

        const data =
            buffer.getChannelData(
                channel
            );

        for (
            let i = 0;
            i < buffer.length;
            i++
        ) {

            mono[i] +=
                data[i] /
                buffer.numberOfChannels;
        }
    }

    return mono;
}


function rms(frame) {

    let sum = 0;

    for (
        let i = 0;
        i < frame.length;
        i++
    ) {
        sum +=
            frame[i] *
            frame[i];
    }

    return Math.sqrt(
        sum /
        frame.length
    );
}


function yinPitch(frame, sampleRate) {

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

            sum +=
                delta * delta;
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

    if (tauEstimate < 0) {

        let bestValue =
            Infinity;

        for (
            let tau = minTau;
            tau <= maxTau;
            tau++
        ) {

            if (
                cmnd[tau] <
                bestValue
            ) {
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

    let betterTau =
        tauEstimate;

    if (
        tauEstimate > minTau &&
        tauEstimate < maxTau
    ) {

        const left =
            cmnd[
                tauEstimate - 1
            ];

        const centre =
            cmnd[
                tauEstimate
            ];

        const right =
            cmnd[
                tauEstimate + 1
            ];

        const denominator =
            (
                2 * centre
            ) -
            left -
            right;

        if (
            Math.abs(
                denominator
            ) >
            1e-12
        ) {

            betterTau =
                tauEstimate +
                0.5 *
                (
                    right -
                    left
                ) /
                denominator;
        }
    }

    return {
        frequency:
            sampleRate /
            betterTau,

        confidence:
            Math.max(
                0,
                Math.min(
                    1,
                    1 -
                    cmnd[
                        tauEstimate
                    ]
                )
            )
    };
}


function median(values) {

    const sorted =
        [...values].sort(
            (a, b) =>
                a - b
        );

    const middle =
        Math.floor(
            sorted.length /
            2
        );

    if (
        sorted.length % 2 === 0
    ) {
        return (
            sorted[
                middle - 1
            ] +
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

    fractions.forEach(
        fraction => {

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
                            frameSize /
                            2
                        )
                    )
                );

            const frame =
                mono.subarray(
                    start,
                    start +
                    frameSize
                );

            if (
                rms(frame) <
                0.003
            ) {
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
                results.push(
                    result
                );
            }
        }
    );

    if (!results.length) {
        throw new Error(
            "No stable pitch detected."
        );
    }

    const roughMedian =
        median(
            results.map(
                result =>
                    result.frequency
            )
        );

    const usable =
        results.filter(
            result => {

                const ratio =
                    result.frequency /
                    roughMedian;

                return (
                    ratio > 0.80 &&
                    ratio < 1.20
                );
            }
        );

    const finalResults =
        usable.length
            ? usable
            : results;

    return {
        frequency:
            median(
                finalResults.map(
                    result =>
                        result.frequency
                )
            ),

        confidence:
            median(
                finalResults.map(
                    result =>
                        result.confidence
                )
            )
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


function midiToNoteName(midi) {

    const names = [
        "C", "Db", "D",
        "Eb", "E", "F",
        "Gb", "G", "Ab",
        "A", "Bb", "B"
    ];

    const rounded =
        Math.round(midi);

    const pitchClass =
        (
            (rounded % 12) +
            12
        ) % 12;

    const octave =
        Math.floor(
            rounded / 12
        ) - 1;

    return (
        names[
            pitchClass
        ] +
        octave
    );
}


function noteNameToMidi(
    noteName
) {

    const match =
        String(noteName).match(
            /^([A-G])([b#]?)(-?\d+)$/
        );

    if (!match) {
        return null;
    }

    const [
        ,
        letter,
        accidental,
        octaveText
    ] = match;

    const base = {
        C: 0,
        D: 2,
        E: 4,
        F: 5,
        G: 7,
        A: 9,
        B: 11
    }[letter];

    let semitone =
        base;

    if (
        accidental === "#"
    ) {
        semitone++;
    }

    if (
        accidental === "b"
    ) {
        semitone--;
    }

    const octave =
        parseInt(
            octaveText,
            10
        );

    return (
        (octave + 1) *
        12 +
        semitone
    );
}


function midiToFrequency(
    midi
) {

    return (
        440 *
        Math.pow(
            2,
            (midi - 69) /
            12
        )
    );
}


function scoreSingleNote(
    expectedNote,
    analysis
) {

    const expectedMidi =
        noteNameToMidi(
            expectedNote
        );

    const detectedMidiFloat =
        frequencyToMidi(
            analysis.frequency
        );

    const detectedMidi =
        Math.round(
            detectedMidiFloat
        );

    const detectedNote =
        midiToNoteName(
            detectedMidi
        );

    const correct =
        detectedMidi ===
        expectedMidi;

    const expectedFrequency =
        midiToFrequency(
            expectedMidi
        );

    const cents =
        1200 *
        Math.log2(
            analysis.frequency /
            expectedFrequency
        );

    /*
     * For a wrong note:
     * note accuracy = 0.
     *
     * For a correct note:
     * tuning score is based only on cents from the
     * expected centre pitch.
     */
    let tuningScore = null;

    if (correct) {

        const absCents =
            Math.abs(cents);

        if (absCents <= 5) {
            tuningScore = 100;
        } else {
            tuningScore =
                Math.max(
                    0,
                    Math.round(
                        100 -
                        (
                            absCents - 5
                        ) *
                        1.6
                    )
                );
        }
    }

    return {
        expectedNote,
        detectedNote,
        correct,
        cents,
        tuningScore,
        confidence:
            analysis.confidence
    };
}


function classForPercent(
    value
) {

    if (value >= 85) {
        return "good";
    }

    if (value >= 60) {
        return "warn";
    }

    return "bad";
}


async function analysePhrase() {

    const button =
        document.getElementById(
            "analyse-phrase"
        );

    const status =
        document.getElementById(
            "status"
        );

    const selectors =
        Array.from(
            document.querySelectorAll(
                ".played-select"
            )
        );

    button.disabled = true;
    button.textContent =
        "Analysing phrase...";

    const results = [];

    try {

        for (
            let index = 0;
            index <
            EXPECTED_PHRASE.length;
            index++
        ) {

            const expected =
                EXPECTED_PHRASE[
                    index
                ];

            const played =
                selectors[
                    index
                ].value;

            status.textContent =
                `Analysing note ${index + 1}/${EXPECTED_PHRASE.length}: ${played}.wav`;

            const buffer =
                await loadSample(
                    played
                );

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

            results.push(
                scoreSingleNote(
                    expected,
                    analysis
                )
            );
        }

        renderResults(results);

        status.textContent =
            "Phrase analysis complete.";

    } catch (error) {

        console.error(error);

        status.textContent =
            `Error: ${error.message}`;

    } finally {

        button.disabled = false;
        button.textContent =
            "Analyse Phrase";
    }
}


function renderResults(results) {

    const correctCount =
        results.filter(
            result =>
                result.correct
        ).length;

    const noteAccuracy =
        Math.round(
            correctCount /
            results.length *
            100
        );

    const correctTuningScores =
        results
            .filter(
                result =>
                    result.correct &&
                    result.tuningScore !== null
            )
            .map(
                result =>
                    result.tuningScore
            );

    const averageTuning =
        correctTuningScores.length
            ? Math.round(
                correctTuningScores.reduce(
                    (sum, value) =>
                        sum + value,
                    0
                ) /
                correctTuningScores.length
            )
            : 0;

    /*
     * Phrase overall:
     * 70% note accuracy
     * 30% tuning of correctly played notes.
     *
     * Timing is deliberately NOT included yet.
     */
    const overall =
        Math.round(
            (
                noteAccuracy *
                0.70
            ) +
            (
                averageTuning *
                0.30
            )
        );

    const noteAccuracyEl =
        document.getElementById(
            "note-accuracy"
        );

    noteAccuracyEl.textContent =
        `${noteAccuracy}%`;

    noteAccuracyEl.className =
        `summary-value ${
            classForPercent(
                noteAccuracy
            )
        }`;

    const tuningEl =
        document.getElementById(
            "tuning-score"
        );

    tuningEl.textContent =
        `${averageTuning}%`;

    tuningEl.className =
        `summary-value ${
            classForPercent(
                averageTuning
            )
        }`;

    const overallEl =
        document.getElementById(
            "overall-score"
        );

    overallEl.textContent =
        `${overall}%`;

    overallEl.className =
        `summary-value ${
            classForPercent(
                overall
            )
        }`;

    const body =
        document.getElementById(
            "results-body"
        );

    body.innerHTML = "";

    results.forEach(
        (result, index) => {

            const row =
                document.createElement(
                    "tr"
                );

            const tuningText =
                result.correct
                    ? `${
                        result.cents >= 0
                            ? "+"
                            : ""
                    }${result.cents.toFixed(
                        1
                    )} cents`
                    : "—";

            row.innerHTML = `
                <td>${index + 1}</td>

                <td>
                    <span class="note-pill">
                        ${result.expectedNote}
                    </span>
                </td>

                <td>
                    <span class="note-pill">
                        ${result.detectedNote}
                    </span>
                </td>

                <td class="${
                    result.correct
                        ? "good"
                        : "bad"
                }">
                    ${
                        result.correct
                            ? "✓ Correct"
                            : "✗ Wrong note"
                    }
                </td>

                <td>${tuningText}</td>

                <td>
                    ${Math.round(
                        result.confidence *
                        100
                    )}%
                </td>
            `;

            body.appendChild(row);
        }
    );

    document.getElementById(
        "summary"
    ).style.display =
        "block";
}


document.addEventListener(
    "DOMContentLoaded",
    () => {

        buildPhraseUI();

        document
            .getElementById(
                "analyse-phrase"
            )
            .addEventListener(
                "click",
                analysePhrase
            );
    }
);
