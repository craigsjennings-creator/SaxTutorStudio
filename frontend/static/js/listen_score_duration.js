/*
 * YourMusicTutorial - Duration / Hold Score Lab v1
 *
 * Duration is currently simulated by the user.
 * Later the same scorer will receive detected note-off times
 * from live microphone analysis.
 */

const PHRASE = [
    { pitch: "C4", duration: 1.00 },
    { pitch: "D4", duration: 1.00 },
    { pitch: "E4", duration: 2.00 },
    { pitch: "F4", duration: 1.00 },
    { pitch: "G4", duration: 3.00 },
    { pitch: "F4", duration: 1.00 },
    { pitch: "E4", duration: 2.00 },
    { pitch: "D4", duration: 1.00 },
    { pitch: "C4", duration: 4.00 }
];


function buildUI() {

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

            const maxDuration =
                Math.max(
                    1,
                    note.duration * 1.75
                );

            row.innerHTML = `
                <div class="num">
                    ${index + 1}
                </div>

                <div class="note">
                    ${note.pitch}
                </div>

                <div class="expected">
                    ${note.duration.toFixed(2)}s
                </div>

                <div class="duration-control">
                    <input
                        type="range"
                        class="duration-slider"
                        data-index="${index}"
                        min="0.05"
                        max="${maxDuration.toFixed(2)}"
                        step="0.01"
                        value="${note.duration.toFixed(2)}"
                    >

                    <input
                        type="number"
                        class="duration-number"
                        data-index="${index}"
                        min="0.05"
                        max="${maxDuration.toFixed(2)}"
                        step="0.01"
                        value="${note.duration.toFixed(2)}"
                    >
                </div>
            `;

            grid.appendChild(row);
        }
    );

    document
        .querySelectorAll(
            ".duration-slider"
        )
        .forEach(slider => {

            slider.addEventListener(
                "input",
                () => {

                    const number =
                        document.querySelector(
                            `.duration-number[data-index="${slider.dataset.index}"]`
                        );

                    if (number) {
                        number.value =
                            slider.value;
                    }
                }
            );
        });

    document
        .querySelectorAll(
            ".duration-number"
        )
        .forEach(number => {

            number.addEventListener(
                "input",
                () => {

                    const slider =
                        document.querySelector(
                            `.duration-slider[data-index="${number.dataset.index}"]`
                        );

                    if (slider) {
                        slider.value =
                            number.value;
                    }
                }
            );
        });
}


function scoreDuration(
    expected,
    actual
) {

    const difference =
        actual -
        expected;

    const absolute =
        Math.abs(
            difference
        );

    const relativeError =
        absolute /
        expected;

    /*
     * Relative bands matter more than raw seconds.
     * Being 0.15s short on a 0.5s note is much more significant
     * than being 0.15s short on a 4s note.
     *
     * <= 5%  = Excellent
     * <= 12% = Good
     * <= 22% = Fair
     * <= 35% = Short/Long
     * > 35%  = Much too short/long
     */

    if (relativeError <= 0.05) {
        return {
            score: 100,
            label: "Excellent"
        };
    }

    if (relativeError <= 0.12) {
        return {
            score:
                Math.round(
                    100 -
                    (
                        (
                            relativeError -
                            0.05
                        ) /
                        0.07
                    ) *
                    12
                ),
            label: "Good"
        };
    }

    if (relativeError <= 0.22) {
        return {
            score:
                Math.round(
                    88 -
                    (
                        (
                            relativeError -
                            0.12
                        ) /
                        0.10
                    ) *
                    23
                ),
            label: "Fair"
        };
    }

    if (relativeError <= 0.35) {
        return {
            score:
                Math.round(
                    65 -
                    (
                        (
                            relativeError -
                            0.22
                        ) /
                        0.13
                    ) *
                    35
                ),
            label:
                difference < 0
                    ? "Short"
                    : "Long"
        };
    }

    return {
        score:
            Math.max(
                0,
                Math.round(
                    30 -
                    (
                        relativeError -
                        0.35
                    ) *
                    55
                )
            ),
        label:
            difference < 0
                ? "Much too short"
                : "Much too long"
    };
}


function scoreClass(value) {

    if (value >= 85) {
        return "good";
    }

    if (value >= 60) {
        return "warn";
    }

    return "bad";
}


function generateCoaching(
    results
) {

    const signedRatios =
        results.map(
            result =>
                (
                    result.actual -
                    result.expected
                ) /
                result.expected
        );

    const meanSigned =
        signedRatios.reduce(
            (sum, value) =>
                sum + value,
            0
        ) /
        signedRatios.length;

    const poor =
        results.filter(
            result =>
                Math.abs(
                    (
                        result.actual -
                        result.expected
                    ) /
                    result.expected
                ) > 0.22
        );

    let text = "";

    if (
        Math.abs(
            meanSigned
        ) <= 0.06
    ) {
        text +=
            "Your note lengths are balanced overall. ";
    } else if (
        meanSigned < 0
    ) {
        text +=
            "You tend to release notes too early. Try listening for the full bar length before changing fingering. ";
    } else {
        text +=
            "You tend to hold notes too long. Try preparing the next fingering as the current bar reaches its end. ";
    }

    if (poor.length) {

        text +=
            `The note lengths needing the most work are ${poor.map(
                result =>
                    result.index + 1
            ).join(", ")}.`;
    } else {
        text +=
            "No individual note was far outside its target duration.";
    }

    return text;
}


function scorePhrase() {

    const inputs =
        Array.from(
            document.querySelectorAll(
                ".duration-number"
            )
        );

    const results =
        PHRASE.map(
            (note, index) => {

                const actual =
                    parseFloat(
                        inputs[index].value
                    ) ||
                    0.05;

                const scored =
                    scoreDuration(
                        note.duration,
                        actual
                    );

                return {
                    index,
                    pitch:
                        note.pitch,
                    expected:
                        note.duration,
                    actual,
                    difference:
                        actual -
                        note.duration,
                    ...scored
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

    const averageScore =
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
                    result.difference
                ) /
                result.expected <=
                0.12
        ).length;

    const averageRelativeError =
        results.reduce(
            (sum, result) =>
                sum +
                (
                    Math.abs(
                        result.difference
                    ) /
                    result.expected
                ),
            0
        ) /
        results.length;

    const signedRelative =
        results.reduce(
            (sum, result) =>
                sum +
                (
                    result.difference /
                    result.expected
                ),
            0
        ) /
        results.length;

    const durationEl =
        document.getElementById(
            "duration-score"
        );

    durationEl.textContent =
        `${averageScore}%`;

    durationEl.className =
        `summary-value ${
            scoreClass(
                averageScore
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
            averageRelativeError *
            100
        )}%`;

    const bias =
        document.getElementById(
            "duration-bias"
        );

    if (
        Math.abs(
            signedRelative
        ) <= 0.06
    ) {

        bias.textContent =
            "Balanced";

        bias.className =
            "summary-value good";

    } else if (
        signedRelative < 0
    ) {

        bias.textContent =
            "Too short";

        bias.className =
            "summary-value warn";

    } else {

        bias.textContent =
            "Too long";

        bias.className =
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
                    ${result.expected.toFixed(2)}s
                </td>

                <td>
                    ${result.actual.toFixed(2)}s
                </td>

                <td>
                    ${
                        result.difference >= 0
                            ? "+"
                            : ""
                    }${result.difference.toFixed(2)}s
                </td>

                <td>
                    ${result.label}
                </td>

                <td class="${
                    scoreClass(
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

        buildUI();

        document
            .getElementById(
                "score-duration"
            )
            .addEventListener(
                "click",
                scorePhrase
            );
    }
);
