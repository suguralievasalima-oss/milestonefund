import { CampaignState, fmtEth, shortAddr, timeLeft } from "../utils";

export function Progress({ value, max }) {
  const pct = max > 0n ? Math.min(100, Number((value * 10000n) / max) / 100) : 0;
  return (
    <div className="progress" title={`${pct}%`}>
      <div className="progress-bar" style={{ width: `${pct}%` }} />
    </div>
  );
}

export default function CampaignList({ campaigns, now, onOpen, onCreate, loading }) {
  return (
    <section>
      <div className="section-head">
        <h1>Campaigns</h1>
        <button className="btn btn-primary" onClick={onCreate}>
          + New campaign
        </button>
      </div>
      {loading && !campaigns.length && <p className="muted">Loading…</p>}
      {!loading && !campaigns.length && <p className="muted">No campaigns yet. Create the first one.</p>}
      <div className="grid">
        {campaigns.map((c) => (
          <article key={c.id} className="card clickable" onClick={() => onOpen(c.id)}>
            <div className="card-top">
              <span className={`state state-${CampaignState[c.state]}`}>{CampaignState[c.state]}</span>
              <span className="muted small">#{c.id}</span>
            </div>
            <h3>{c.title}</h3>
            <Progress value={c.totalRaised} max={c.goal} />
            <div className="row small">
              <span>
                <b>{fmtEth(c.totalRaised)}</b> / {fmtEth(c.goal)}
              </span>
              <span className="muted">
                {c.state === 0
                  ? timeLeft(c.deadline, now)
                  : `milestone ${Math.min(c.currentMilestone + 1, c.milestoneCount)}/${c.milestoneCount}`}
              </span>
            </div>
            <div className="muted small">by {shortAddr(c.creator)}</div>
          </article>
        ))}
      </div>
    </section>
  );
}
