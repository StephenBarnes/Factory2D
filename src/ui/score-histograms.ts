import { SCORE_METRICS, type PuzzleHistograms, type ScoreHistogramBucket, type ScoreMetric } from "../game/community-api";
import type { PuzzleScores } from "../game/puzzle-scores";
import { buildScoreHistogram, scoreStanding } from "../game/score-histogram";
import { expectDefined } from "../util/assert";
import { formatPuzzleScore } from "./puzzle-score-format";
import "./score-histograms.css";

const METRIC_LABELS: Record<ScoreMetric, string> = {
  price: "Price",
  cycles: "Average cycles",
  footprint: "Footprint",
  combined: "Combined",
};

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function playerCount(count: number): string {
  return `${count} ${count === 1 ? "player" : "players"}`;
}

// Bucket boundaries must retain precision even when ordinary score labels round.
function bucketBound(value: number): string {
  const formatted = formatPuzzleScore(value);
  return Number(formatted) === value ? formatted : String(value);
}

function markerKey(kind: "best" | "current", label: string): HTMLElement {
  const key = element("span", "score-histogram-key");
  const symbol = element("span", `score-histogram-symbol score-histogram-symbol--${kind}`);
  symbol.setAttribute("aria-hidden", "true");
  key.append(symbol, document.createTextNode(label));
  return key;
}

function appendLocalScore(
  list: HTMLDListElement,
  kind: "best" | "current",
  score: number,
  frequencies: readonly ScoreHistogramBucket[] | undefined,
): void {
  const entry = element("div", `score-histogram-local score-histogram-local--${kind}`);
  const value = element("dd", "", formatPuzzleScore(score));
  const standing = frequencies === undefined ? null : scoreStanding(frequencies, score);
  if (standing !== null) value.dataset.scoreMineral = standing.mineral;
  entry.append(
    element("dt", "", kind === "best" ? "Local best" : "This run"),
    value,
  );
  list.append(entry);
}

function appendChart(
  card: HTMLElement,
  label: string,
  frequencies: readonly ScoreHistogramBucket[],
  best: number | undefined,
  current: number | undefined,
): void {
  const markers: number[] = [];
  if (best !== undefined) markers.push(best);
  if (current !== undefined) markers.push(current);
  const histogram = buildScoreHistogram(frequencies, markers);
  if (histogram.bins.length === 0) {
    card.append(element("p", "score-histogram-empty", "No community submissions yet. Chart and rank unavailable."));
    return;
  }

  let peak = 0;
  let players = 0;
  let lowest = Infinity;
  for (const bin of histogram.bins) peak = Math.max(peak, bin.count);
  for (const frequency of frequencies) {
    players += frequency.count;
    if (frequency.count > 0) lowest = Math.min(lowest, frequency.value);
  }

  const figure = element("figure", "score-histogram-figure");
  figure.setAttribute("aria-label", `${label} community score distribution`);
  const scale = element("div", "score-histogram-scale");
  scale.append(
    element("span", "", `Players per bucket · 0–${peak}`),
    element("span", "", `${playerCount(players)} total`),
  );
  const plot = element("div", "score-histogram-plot");
  const bars = element("div", "score-histogram-bars");
  const inspection = element("figcaption", "score-histogram-inspection", "Hover or focus to inspect a bucket.");
  inspection.setAttribute("role", "status");
  inspection.setAttribute("aria-live", "polite");
  inspection.setAttribute("aria-atomic", "true");
  const buttons: HTMLButtonElement[] = [];
  let selected: HTMLButtonElement | null = null;

  histogram.bins.forEach((bin, index) => {
    const exactRange = histogram.bins.length === 1 && bin.lower === bin.upper
      ? `Score = ${bucketBound(bin.lower)}`
      : `Score ≥ ${bucketBound(bin.lower)} and ${index === histogram.bins.length - 1 ? "≤" : "<"} ${bucketBound(bin.upper)}`;
    const description = `${exactRange}: ${playerCount(bin.count)}.`;
    const button = element("button", "score-histogram-bucket");
    button.type = "button";
    button.tabIndex = index === 0 ? 0 : -1;
    button.ariaLabel = description;
    button.title = description;
    button.setAttribute("aria-pressed", "false");
    const bar = element("span", "score-histogram-bar");
    bar.style.height = `${peak === 0 ? 0 : 100 * bin.count / peak}%`;
    bar.setAttribute("aria-hidden", "true");
    if (bin.count > 0) button.append(bar);
    if (index === 0) selected = button;
    const inspect = (): void => {
      inspection.textContent = description;
      if (selected !== null) {
        selected.setAttribute("aria-pressed", "false");
        selected.tabIndex = -1;
      }
      selected = button;
      button.tabIndex = 0;
      button.setAttribute("aria-pressed", "true");
    };
    button.addEventListener("pointerenter", inspect);
    button.addEventListener("focus", inspect);
    button.addEventListener("click", inspect);
    button.addEventListener("keydown", (event) => {
      let next: number;
      switch (event.key) {
        case "ArrowLeft":
        case "ArrowDown": next = Math.max(0, index - 1); break;
        case "ArrowRight":
        case "ArrowUp": next = Math.min(buttons.length - 1, index + 1); break;
        case "Home": next = 0; break;
        case "End": next = buttons.length - 1; break;
        default: return;
      }
      event.preventDefault();
      event.stopPropagation();
      expectDefined(buttons[next], "Histogram bucket must exist").focus();
    });
    buttons.push(button);
    bars.append(button);
  });
  plot.append(bars);

  const addMarker = (kind: "best" | "current", score: number): void => {
    const marker = element("span", `score-histogram-marker score-histogram-marker--${kind}`);
    const span = histogram.maximum - histogram.minimum;
    marker.style.left = `${span === 0 ? 50 : 100 * (score - histogram.minimum) / span}%`;
    marker.setAttribute("aria-hidden", "true");
    marker.append(element("span", `score-histogram-symbol score-histogram-symbol--${kind}`));
    plot.append(marker);
  };
  if (best !== undefined) addMarker("best", best);
  if (current !== undefined) addMarker("current", current);

  const axis = element("div", "score-histogram-axis");
  axis.append(
    element("span", "", bucketBound(histogram.minimum)),
    element("span", "", bucketBound(histogram.maximum)),
  );
  figure.append(scale, plot, axis, inspection);
  card.append(figure);
  const record = element("p", "score-histogram-record", `Lowest submitted: ${formatPuzzleScore(lowest)}`);
  card.append(record);
}

/** Replace only this root; lifecycle and community-fetch status belong to the caller. */
export function renderScoreHistograms(
  root: HTMLElement,
  data: PuzzleHistograms | null,
  best: PuzzleScores | null,
  current: PuzzleScores | null,
  headingStatus?: HTMLElement,
): void {
  root.classList.add("score-histograms");
  const content = document.createDocumentFragment();
  const heading = element("div", "score-histograms-heading");
  const title = element("h3", "", "Community scores");
  if (headingStatus !== undefined) title.append(headingStatus);
  heading.append(title);
  const legend = element("div", "score-histograms-legend");
  if (best !== null) legend.append(markerKey("best", "Local best"));
  if (current !== null) legend.append(markerKey("current", "This run"));
  heading.append(legend);
  content.append(heading);

  const grid = element("div", "score-histograms-grid");
  for (const metric of SCORE_METRICS) {
    const card = element("section", "score-histogram-card");
    card.append(element("h4", "score-histogram-title", METRIC_LABELS[metric]));
    const local = element("dl", "score-histogram-locals");
    if (best !== null) appendLocalScore(local, "best", best[metric], data?.metrics[metric]);
    if (current !== null) appendLocalScore(local, "current", current[metric], data?.metrics[metric]);
    if (best === null && current === null) {
      card.append(element("p", "score-histogram-unranked", "No confirmed local score."));
    } else {
      card.append(local);
    }

    const score = current?.[metric] ?? best?.[metric];
    if (data === null) {
      card.append(element("p", "score-histogram-empty", "Community chart and rank unavailable. Local scores remain available offline."));
    } else {
      const frequencies = data.metrics[metric];
      const standing = score === undefined ? null : scoreStanding(frequencies, score);
      if (standing !== null) {
        const rank = element("div", "score-histogram-standing");
        const badge = element("strong", "score-histogram-rank", standing.mineral);
        badge.dataset.scoreMineral = standing.mineral;
        const percentile = formatPuzzleScore(standing.percentile);
        const approximation = Number(percentile) === standing.percentile ? "" : "≈";
        const description = `${current !== null ? "This run" : "Local best"} · Percentile ${approximation}${percentile}${standing.players < 10 ? " · provisional" : ""}`;
        rank.append(badge, element("span", "", description));
        rank.title = `${playerCount(standing.better)} with a lower score; ${playerCount(standing.tied)} tied; ${playerCount(standing.players)} in the cohort.`;
        card.append(rank);
      } else if (score === undefined && frequencies.length > 0) {
        card.append(element("p", "score-histogram-unranked", "Complete a solution to earn a rank."));
      }
      appendChart(card, METRIC_LABELS[metric], frequencies, best?.[metric], current?.[metric]);
    }
    grid.append(card);
  }
  content.append(grid);
  const policy = element("details", "score-histograms-policy");
  policy.append(
    element("summary", "", "How scores and mineral ranks work"),
    element("p", "", "Lower is better for every metric. Bars count players, not solutions: each player contributes their best submitted score per metric for this puzzle revision and scoring version."),
    element("p", "", "Percentile is the percentage of players whose score is equal to or higher than yours. Mithril: ≥75; Gold: ≥50; Iron: ≥25; Coal: below 25. Ranks use unrounded percentiles and are provisional with fewer than 10 players."),
    element("p", "", "Each metric is compared independently. Combined is price + average cycles + footprint for one solution, not a sum of independent bests. Chart bounds include your markers."),
  );
  content.append(policy);
  root.replaceChildren(content);
}
