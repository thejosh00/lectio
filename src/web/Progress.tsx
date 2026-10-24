/**
 * Progress: is it sticking? Retention by week leads; same-day accuracy against its
 * target, calibration, and time against the budget follow; then what's working for you,
 * always with n. No streaks, no points: an honest page is the motivation.
 */
import {useState} from 'react';
import {enc, type Predictions, type Progress, type Rate, type Subject} from './api.ts';
import {Chart, ShareBars} from './Charts.tsx';
import {pct, useLoad} from './state.ts';

const rateText = (r: Rate) => (r.n === 0 ? '—' : `${pct(r.rate)} (${r.n})`);

function Stat({label, value, sub}: {label: string; value: string; sub?: string}) {
  return (
    <div className="stat">
      <div className="label">{label}</div>
      <div className="value">{value}</div>
      {sub !== undefined && <div className="sub">{sub}</div>}
    </div>
  );
}

function OutcomeTable({title, note, rows}: {title: string; note: string; rows: Array<{name: string; cells: string[]}>; }) {
  if (rows.length === 0) return null;
  return (
    <div className="card">
      <h3 style={{fontSize: 15}}>{title}</h3>
      <p className="small-text muted" style={{margin: '2px 0 6px'}}>
        {note}
      </p>
      <div className="table-wrap">
        <table className="data">
          <tbody>
            {rows.map(r => (
              <tr key={r.name}>
                <td>{r.name.replace(/_/g, ' ')}</td>
                {r.cells.map((c, i) => (
                  <td key={i} className="num">
                    {c}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** The tutor's predictions against what happened: a tutor that predicts you well knows where you are. */
function PredictionsCard({p}: {p: Predictions}) {
  const bins = p.tutor.bins.filter(b => b.n > 0);
  const brier = (x: number | null) => (x === null ? '—' : x.toFixed(2));
  return (
    <div className="card">
      <h3 style={{fontSize: 15}}>How well your tutor knows you</h3>
      <p className="sub small-text muted" style={{margin: '2px 0 8px'}}>
        Before each quiz your tutor predicts how likely you are to get each question right. Its misses show it where its picture of you is wrong.
      </p>
      {p.n === 0 ? (
        <p className="muted small-text">This fills in once you answer quizzes your tutor wrote predictions for.</p>
      ) : (
        <>
          <div className="stat-row">
            <Stat label="Your tutor" value={brier(p.tutor.brier)} sub="prediction error" />
            <Stat label="A formula" value={brier(p.formula.brier)} sub="memory model alone" />
            <Stat label="Predictions" value={`${p.n}`} sub={p.skill === null ? 'lower error is better' : p.skill > 0 ? 'your tutor is ahead' : 'the formula is ahead'} />
          </div>
          {bins.length > 0 && (
            <>
              <p className="small-text muted" style={{margin: '10px 0 4px'}}>
                When it said…, you got this share right:
              </p>
              <ShareBars rows={bins.map(b => ({label: `${Math.round(b.from * 100)}–${Math.round(b.to * 100)}%`, rate: b.actual, n: b.n}))} />
            </>
          )}
          {p.by_week.length >= 2 && (
            <Chart
              ariaLabel="your tutor's prediction error by week"
              points={p.by_week.map(w => ({x: w.week, y: w.tutor_brier ?? 0, note: `${w.n} predictions`}))}
              max={Math.max(0.3, ...p.by_week.map(w => w.tutor_brier ?? 0))}
              format={y => y.toFixed(2)}
              reference={p.formula.brier === null ? undefined : {y: p.formula.brier, label: `formula ${brier(p.formula.brier)}`}}
            />
          )}
        </>
      )}
    </div>
  );
}

export function ProgressView({ships = []}: {ships?: Array<{week: string; label: string}>}) {
  const subjects = useLoad<{subjects: Subject[]}>('/api/subjects');
  const [subject, setSubject] = useState<string>();
  const {data} = useLoad<{progress: Progress}>(`/api/progress${subject === undefined ? '' : `?subject=${enc(subject)}`}`);
  const p = data?.progress;
  return (
    <div>
      <h2 className="page">Progress</h2>
      <div className="seg">
        <button type="button" className={subject === undefined ? 'on' : ''} onClick={() => setSubject(undefined)}>
          All
        </button>
        {subjects.data?.subjects
          .filter(s => s.status !== 'archived')
          .map(s => (
            <button key={s.id} type="button" className={subject === s.id ? 'on' : ''} onClick={() => setSubject(s.id)}>
              {s.title}
            </button>
          ))}
      </div>
      {p === undefined ? (
        <p className="loading">…</p>
      ) : (
        <div>
          <div className="stat-row">
            <Stat label="Retained" value={pct(p.retention.rate)} sub={p.retention.n === 0 ? 'no reviews yet' : `of ${p.retention.n} later reviews`} />
            <Stat label="Same day" value={pct(p.same_day_accuracy.rate)} sub={`target ${pct(p.target_accuracy)}`} />
            <Stat label="Solid" value={`${p.concepts.solid}`} sub={`of ${p.concepts.introduced} · ${p.concepts.due} due`} />
          </div>

          <div className="section">Is it sticking?</div>
          <div className="card chart-card">
            <h3>Retention by week</h3>
            <p className="sub">Delayed reviews answered right the first time, without a hint, not guessing.{ships.length > 0 ? ' Lines mark when changes to lectio shipped.' : ''}</p>
            {p.retention_by_week.length === 0 ? (
              <p className="muted small-text">This fills in once you start reviewing things a day or more after you learned them.</p>
            ) : (
              <Chart
                ariaLabel="retention by week"
                points={p.retention_by_week.map(w => ({x: w.week, y: w.rate, note: `${w.n} reviews`}))}
                max={1}
                format={y => `${Math.round(y * 100)}%`}
                marks={ships.map(s => ({x: s.week, label: s.label}))}
              />
            )}
          </div>

          <div className="card chart-card">
            <h3>Same-day accuracy by week</h3>
            <p className="sub">First tries on new material. Much higher than the target means too easy; much lower, too hard.</p>
            {p.same_day_accuracy_by_week.length === 0 ? (
              <p className="muted small-text">No quizzes on new material yet.</p>
            ) : (
              <Chart
                ariaLabel="same-day accuracy by week"
                points={p.same_day_accuracy_by_week.map(w => ({x: w.week, y: w.rate, note: `${w.n} first tries`}))}
                max={1}
                format={y => `${Math.round(y * 100)}%`}
                reference={{y: p.target_accuracy, label: `target ${pct(p.target_accuracy)}`}}
              />
            )}
          </div>

          <div className="card">
            <h3 style={{fontSize: 15}}>How sure you were, and how often you were right</h3>
            <p className="sub small-text muted" style={{margin: '2px 0 8px'}}>
              "Sure" and wrong points at a misconception, not a slip.
            </p>
            <ShareBars
              rows={[
                {label: 'Sure', ...p.calibration.by_confidence.sure},
                {label: 'Think so', ...p.calibration.by_confidence.think},
                {label: 'Guessing', ...p.calibration.by_confidence.guess},
              ]}
            />
            {p.calibration.sure_but_wrong.length > 0 && (
              <p className="small-text muted">Sure but wrong: {p.calibration.sure_but_wrong.map(s => `${s.key} ×${s.count}`).join(', ')}</p>
            )}
          </div>

          {p.load !== null && (
            <div className="card chart-card">
              <h3>Time against your budget</h3>
              <p className="sub">
                Minutes a day reading and answering; your budget is {p.load.budget_minutes}. {p.load.lessons_finished} lessons finished, {p.load.lessons_skipped} skipped.
              </p>
              {p.load.days.length === 0 ? (
                <p className="muted small-text">Nothing yet.</p>
              ) : (
                <Chart
                  kind="columns"
                  ariaLabel="minutes per day against the budget"
                  points={p.load.days.map(d => ({x: d.day, y: d.minutes}))}
                  max={Math.max(p.load.budget_minutes * 1.5, ...p.load.days.map(d => d.minutes))}
                  format={y => `${Math.round(y)}m`}
                  reference={{y: p.load.budget_minutes, label: `budget ${p.load.budget_minutes}m`}}
                />
              )}
            </div>
          )}

          <PredictionsCard p={p.predictions} />

          <div className="section">What's working</div>
          {p.approaches.length === 0 && p.question_types.length === 0 && <p className="muted">This builds up as your tutor tries different ways of teaching and you review what you learned.</p>}
          <OutcomeTable
            title="Ways of teaching"
            note="Concepts introduced with it · retained on later reviews (n) · without it (n)"
            rows={p.approaches.filter(a => a.with.concepts > 0).map(a => ({name: a.approach, cells: [`${a.with.concepts}`, rateText(a.with), rateText(a.without)]}))}
          />
          <OutcomeTable
            title="Kinds of question"
            note="Retained on later reviews (n) · right first time, same day (n)"
            rows={p.question_types.map(g => ({name: g.group, cells: [rateText(g.retention), rateText(g.same_day_accuracy)]}))}
          />
          {p.misconceptions.length > 0 && (
            <div className="card">
              <h3 style={{fontSize: 15}}>Wrong ideas that came up (last 30 days)</h3>
              <ul className="list small-text">
                {p.misconceptions.map(m => (
                  <li key={m.tag}>
                    <strong>{m.tag.replace(/-/g, ' ')}</strong> ×{m.count} <span className="muted">· {m.concept_keys.join(', ')}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
