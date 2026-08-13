/*
 * YourMusicTutorial - Timing Score Lab v1
 *
 * Timing is simulated with user-controlled early/late offsets.
 * This lets us prove the timing bands and coaching logic before
 * microphone capture is added.
 */

const PHRASE = [
    { pitch: "C4", start: 0.00 },
    { pitch: "D4", start: 1.00 },
    { pitch: "E4", start: 2.00 },
    { pitch: "F4", start: 3.00 },
    { pitch: "G4", start: 4.00 },
    { pitch: "F4", start: 5.00 },
    { pitch: "E4", start: 6.00 },
    { pitch: "D4", start: 7.00 },
    { pitch: "C4", start: 8.00 }
];


function buildPhraseUI() {

    const grid =
        document.getElementById(
            "phrase-grid"
        );

    PHRASE.forEach(
        (note, index) => {

            const row =
                document.createElement(
                    "div"
                );

            row.className =
                "phrase-row";

            row.innerHTML = `
                <div class="num">
                    ${index + 1}
                </div>

                <div class="expected-note">
                    ${note.pitch}
                </div>

                <div class="timing-control">
                    <input
                        type="range"
                        class="timing-slider"
                        data-index="${index}"
                        min="-0.60"
                        max="0.60"
                        step="0.01"
                        value="0"
                    >

                    <input
                        type="number"
                        class="timing-number"
                        data-index="${index}"
                        min="-0.60"
                        max="0.60"
                        step="0.01"
                        value="0"
                    >
                </div>

                <div class="expected-time">
                    ${note.start.toFixed(2)}s
                </div>
            `;

            grid.appendChild(row);
        }
    );

    const sliders =
        document.querySelectorAll(
            ".timing-slider"
        );

    sliders.forEach(slider => {

        slider.addEventListener(
            "input",
            () => {

                const index =
                    slider.dataset.index;

                const number =
                    document.querySelector(
                        `.timing-number[data-index="${index}"]`
                    );

                if (number) {
                    number.value =
                        slider.value;
                }
            }
        );
    });

    const numbers =
        document.querySelectorAll(
            ".timing-number"
        );

    numbers.forEach(number => {

        number.addEventListener(
            "input",
            () => {

                const index =
                    number.dataset.index;

                const slider =
                    document.querySelector(
                        `.timing-slider[data-index="${index}"]`
                    );

                if (slider) {
                    slider.value =
                        number.value;
                }
            }
        );
    });
}


function scoreTimingError(
    errorSeconds
) {

    const abs =
        Math.abs(
            errorSeconds
        );

    /*
     * Beginner-friendly bands.
     *
     * <= 50 ms    = Excellent
     * <= 120 ms   = Good
     * <= 220 ms   = Fair
     * <= 350 ms   = Late/Early
     * > 350 ms    = Missed timing
     */
    if (abs <= 0.05) {
        return {
            score: 100,
            label: "Excellent",
            className: "good"
        };
    }

    if (abs <= 0.12) {
        return {
            score:
                Math.round(
                    100 -
                    (
                        (abs - 0.05) /
                        0.07
                    ) *
                    12
                ),
            label: "Good",
            className: "good"
        };
    }

    if (abs <= 0.22) {
        return {
            score:
                Math.round(
                    88 -
                    (
                        (abs - 0.12) /
                        0.10
                    ) *
                    23
                ),
            label: "Fair",
            className: "warn"
        };
    }

    if (abs <= 0.35) {
        return {
            score:
                Math.round(
                    65 -
                    (
                        (abs - 0.22) /
                        0.13
                    ) *
                    35
                ),
            label:
                errorSeconds < 0
                    ? "Early"
                    : "Late",
            className: "warn"
        };
    }

    return {
        score:
            Math.max(
                0,
                Math.round(
                    30 -
                    (
                        abs - 0.35
                    ) *
                    60
                )
            ),
        label:
            errorSeconds < 0
                ? "Very early"
                : "Very late",
        className: "bad"
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


function formatSignedSeconds(
    value
) {

    return `${
        value >= 0
            ? "+"
            : ""
    }${value.toFixed(2)}s`;
}


function generateCoaching(
    results
) {

    const errors =
        results.map(
            result =>
                result.error
        );

    const meanSigned =
        errors.reduce(
            (sum, value) =>
                sum + value,
            0
        ) /
        errors.length;

    const averageAbs =
        errors.reduce(
            (sum, value) =>
                sum +
                Math.abs(value),
            0
        ) /
        errors.length;

    const poor =
        results.filter(
            result =>
                Math.abs(
                    result.error
                ) > 0.22
        );

    let message = "";

    if (
        averageAbs <= 0.08
    ) {
        message +=
            "Your timing is very consistent. ";
    } else if (
        averageAbs <= 0.16
    ) {
        message +=
            "Your timing is generally solid, with a few entries to tighten up. ";
    } else {
        message +=
            "Your timing varies enough that slowing the phrase down could help. ";
    }

    if (
        meanSigned >= 0.08
    ) {
        message +=
            "You tend to enter notes late. Try preparing the fingering slightly earlier as the note approaches the playhead. ";
    } else if (
        meanSigned <= -0.08
    ) {
        message +=
            "You tend to enter notes early. Try waiting until the note reaches the playhead before starting it. ";
    } else {
        message +=
            "There is no strong overall early/late bias. ";
    }

    if (poor.length) {

        const noteNumbers =
            poor
                .map(
                    result =>
                        result.index + 1
                )
                .join(", ");

        message +=
            `The notes needing the most timing work are ${noteNumbers}.`;
    }

    return message;
}


function scorePhrase() {

    const numberInputs =
        Array.from(
            document.querySelectorAll(
                ".timing-number"
            )
        );

    const results =
        PHRASE.map(
            (note, index) => {

                const offset =
                    parseFloat(
                        numberInputs[
                            index
                        ].value
                    ) || 0;

                const playedStart =
                    note.start +
                    offset;

                const timing =
                    scoreTimingError(
                        offset
                    );

                return {
                    index,
                    pitch:
                        note.pitch,
                    expectedStart:
                        note.start,
                    playedStart,
                    error:
                        offset,
                    ...timing
                };
            }
        );

    renderResults(
        results
    );
}


function renderResults(
    results
) {

    const timingScore =
        Math.round(
            results.reduce(
                (sum, result) =>
                    sum +
                    result.score,
                0
            ) /
            results.length
        );

    const goodCount =
        results.filter(
            result =>
                Math.abs(
                    result.error
                ) <= 0.12
        ).length;

    const averageError =
        results.reduce(
            (sum, result) =>
                sum +
                Math.abs(
                    result.error
                ),
            0
        ) /
        results.length;

    const signedAverage =
        results.reduce(
            (sum, result) =>
                sum +
                result.error,
            0
        ) /
        results.length;

    const scoreEl =
        document.getElementById(
            "timing-score"
        );

    scoreEl.textContent =
        `${timingScore}%`;

    scoreEl.className =
        `summary-value ${
            classForPercent(
                timingScore
            )
        }`;

    document.getElementById(
        "good-count"
    ).textContent =
        `${goodCount}/${results.length}`;

    document.getElementById(
        "average-error"
    ).textContent =
        `${Math.round(
            averageError *
            1000
        )} ms`;

    const biasEl =
        document.getElementById(
            "timing-bias"
        );

    if (
        Math.abs(
            signedAverage
        ) < 0.04
    ) {
        biasEl.textContent =
            "Balanced";
        biasEl.className =
            "summary-value good";
    } else if (
        signedAverage > 0
    ) {
        biasEl.textContent =
            "Late";
        biasEl.className =
            "summary-value warn";
    } else {
        biasEl.textContent =
            "Early";
        biasEl.className =
            "summary-value warn";
    }

    document.getElementById(
        "coaching"
    ).textContent =
        generateCoaching(
            results
        );

    const body =
        document.getElementById(
            "results-body"
        );

    body.innerHTML = "";

    results.forEach(
        result => {

            const row =
                document.createElement(
                    "tr"
                );

            row.innerHTML = `
                <td>${result.index + 1}</td>

                <td>
                    <span class="note-pill">
                        ${result.pitch}
                    </span>
                </td>

                <td>
                    ${result.expectedStart.toFixed(2)}s
                </td>

                <td>
                    ${result.playedStart.toFixed(2)}s
                </td>

                <td>
                    ${formatSignedSeconds(
                        result.error
                    )}
                </td>

                <td class="${result.className}">
                    ${result.label}
                </td>

                <td class="${
                    classForPercent(
                        result.score
                    )
                }">
                    ${result.score}%
                </td>
            `;

            body.appendChild(
                row
            );
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
                "score-timing"
            )
            .addEventListener(
                "click",
                scorePhrase
            );
    }
);
