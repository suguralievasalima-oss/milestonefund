import { useEffect, useState } from "react";
import { parseEther } from "ethers";
import { CampaignState, MilestoneStatus, decodeError, fmtEth, fmtTime, shortAddr, timeLeft } from "../utils";
import { Progress } from "./CampaignList";

export default function CampaignDetails({ wallet, campaign: c, now, version, onBack, onChanged }) {
  const [milestones, setMilestones] = useState([]);
  const [me, setMe] = useState({ contribution: 0n, voted: false, refunded: false });
  const [submissionPeriod, setSubmissionPeriod] = useState(null);
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");

  const { readContract, writeContract, account } = wallet;

  useEffect(() => {
    if (!readContract) return;
    readContract
      .submissionPeriod()
      .then((p) => setSubmissionPeriod(Number(p)))
      .catch((e) => console.error(e));
  }, [readContract]);

  // Load milestones and the current user's data
  useEffect(() => {
    if (!readContract || !c) return;
    let cancelled = false;
    (async () => {
      const ms = await Promise.all(
        Array.from({ length: c.milestoneCount }, (_, i) => readContract.getMilestone(c.id, i))
      );
      let mine = { contribution: 0n, voted: false, refunded: false };
      if (account) {
        const idx = Math.min(c.currentMilestone, c.milestoneCount - 1);
        const [contribution, voted, refunded] = await Promise.all([
          readContract.getContribution(c.id, account),
          readContract.hasVotedOn(c.id, idx, account),
          readContract.isRefunded(c.id, account),
        ]);
        mine = { contribution, voted, refunded };
      }
      if (!cancelled) {
        setMilestones(
          ms.map((m) => ({
            description: m.description,
            amount: m.amount,
            voteEnd: Number(m.voteEnd),
            yesWeight: m.yesWeight,
            noWeight: m.noWeight,
            status: Number(m.status),
          }))
        );
        setMe(mine);
      }
    })().catch((e) => console.error(e));
    return () => {
      cancelled = true;
    };
  }, [readContract, c, account, version]);

  if (!c) return <p className="muted">Loading…</p>;

  const state = CampaignState[c.state];
  const isCreator = account && account.toLowerCase() === c.creator.toLowerCase();
  const current = c.currentMilestone < c.milestoneCount ? milestones[c.currentMilestone] : null;
  const fundingOpen = c.state === 0 && now < c.deadline;
  const canFinalizeFunding = c.state === 0 && (now >= c.deadline || c.totalRaised >= c.goal);
  // Deadline for the creator to submit the current milestone for a vote
  const submitBy = submissionPeriod !== null && c.state === 1 ? c.lastProgress + submissionPeriod : null;
  const stalled = submitBy !== null && current?.status === 0 && now >= submitBy;

  let refundEstimate = 0n;
  if (me.contribution > 0n && !me.refunded) {
    if (c.state === 2) refundEstimate = me.contribution;
    if (c.state === 4) refundEstimate = (me.contribution * (c.totalRaised - c.released)) / c.totalRaised;
  }

  async function run(label, fn, successText) {
    setError("");
    setInfo("");
    if (!writeContract) return setError("Connect your wallet first.");
    setBusy(label);
    try {
      const tx = await fn();
      await tx.wait();
      setInfo(successText);
      onChanged();
    } catch (err) {
      setError(decodeError(err, writeContract.interface));
    } finally {
      setBusy("");
    }
  }

  const Btn = ({ label, onClick, kind = "primary" }) => (
    <button className={`btn btn-${kind}`} disabled={!!busy} onClick={onClick}>
      {busy === label ? "Confirm in wallet…" : label}
    </button>
  );

  return (
    <section>
      <button className="link" onClick={onBack}>
        ← All campaigns
      </button>

      <div className="detail-head">
        <div>
          <span className={`state state-${state}`}>{state}</span>
          <h1>{c.title}</h1>
          <p className="muted small">
            Campaign #{c.id} · creator {shortAddr(c.creator)} {isCreator && <b>(you)</b>}
          </p>
        </div>
      </div>

      <div className="detail-grid">
        <div className="card">
          <h3>Funding</h3>
          <Progress value={c.totalRaised} max={c.goal} />
          <div className="stats">
            <div>
              <span className="muted small">Raised</span>
              <b>{fmtEth(c.totalRaised)}</b>
            </div>
            <div>
              <span className="muted small">Goal</span>
              <b>{fmtEth(c.goal)}</b>
            </div>
            <div>
              <span className="muted small">Released</span>
              <b>{fmtEth(c.released)}</b>
            </div>
            <div>
              <span className="muted small">Deadline</span>
              <b title={fmtTime(c.deadline)}>{c.state === 0 ? timeLeft(c.deadline, now) : fmtTime(c.deadline)}</b>
            </div>
          </div>
          {account && (
            <p className="small">
              Your contribution: <b>{fmtEth(me.contribution)}</b>
              {c.totalRaised > 0n && me.contribution > 0n && (
                <span className="muted">
                  {" "}
                  · vote weight {Number((me.contribution * 10000n) / c.totalRaised) / 100}%
                </span>
              )}
            </p>
          )}
        </div>

        <div className="card actions">
          <h3>Actions</h3>
          {!account && <p className="muted">Connect your wallet to interact.</p>}

          {account && fundingOpen && (
            <div className="inline">
              <input
                placeholder="Amount in ETH"
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
              <Btn
                label="Contribute"
                onClick={() => {
                  let value;
                  try {
                    value = parseEther(amount || "0");
                  } catch {
                    return setError("Invalid amount.");
                  }
                  run("Contribute", () => writeContract.contribute(c.id, { value }), "Contribution sent.").then(
                    () => setAmount("")
                  );
                }}
              />
            </div>
          )}

          {account && canFinalizeFunding && (
            <Btn
              label="Finalize funding"
              kind="secondary"
              onClick={() => run("Finalize funding", () => writeContract.finalizeFunding(c.id), "Funding finalized.")}
            />
          )}

          {account && c.state === 1 && current && (
            <>
              <p className="small">
                Current milestone <b>#{c.currentMilestone + 1}</b>: {current.description} ({fmtEth(current.amount)}) —{" "}
                <b>{MilestoneStatus[current.status]}</b>
              </p>

              {current.status === 0 && submitBy !== null && !stalled && (
                <p className="muted small">
                  The creator must submit it by {fmtTime(submitBy)} ({timeLeft(submitBy, now)}).
                </p>
              )}
              {current.status === 0 && isCreator && !stalled && (
                <Btn
                  label="Start milestone vote"
                  onClick={() =>
                    run("Start milestone vote", () => writeContract.startMilestoneVote(c.id), "Voting started.")
                  }
                />
              )}
              {current.status === 0 && !isCreator && !stalled && (
                <p className="muted small">Waiting for the creator to submit this milestone for a vote.</p>
              )}
              {stalled && (
                <>
                  <p className="bad small">The creator missed the deadline. Anyone can cancel the campaign.</p>
                  <Btn
                    label="Cancel stalled campaign"
                    kind="danger"
                    onClick={() =>
                      run(
                        "Cancel stalled campaign",
                        () => writeContract.cancelStalled(c.id),
                        "Campaign cancelled. Investors can now claim refunds."
                      )
                    }
                  />
                </>
              )}

              {current.status === 1 && now < current.voteEnd && (
                <>
                  <p className="muted small">Voting ends in {timeLeft(current.voteEnd, now)}.</p>
                  {isCreator && <p className="muted small">The creator cannot vote on their own milestones.</p>}
                  {me.contribution > 0n && !me.voted && !isCreator && (
                    <div className="inline">
                      <Btn
                        label="Approve"
                        kind="ok"
                        onClick={() => run("Approve", () => writeContract.vote(c.id, true), "Vote recorded.")}
                      />
                      <Btn
                        label="Reject"
                        kind="danger"
                        onClick={() => run("Reject", () => writeContract.vote(c.id, false), "Vote recorded.")}
                      />
                    </div>
                  )}
                  {me.voted && <p className="ok small">You have voted on this milestone.</p>}
                  {me.contribution === 0n && !isCreator && <p className="muted small">Only investors can vote.</p>}
                </>
              )}

              {current.status === 1 && now >= current.voteEnd && (
                <Btn
                  label="Finalize vote"
                  kind="secondary"
                  onClick={() => run("Finalize vote", () => writeContract.finalizeMilestone(c.id), "Vote finalized.")}
                />
              )}

              {current.status === 2 && isCreator && (
                <Btn
                  label="Withdraw milestone funds"
                  onClick={() =>
                    run("Withdraw milestone funds", () => writeContract.withdrawMilestone(c.id), "Funds withdrawn.")
                  }
                />
              )}
              {current.status === 2 && !isCreator && (
                <p className="muted small">Approved — waiting for the creator to withdraw.</p>
              )}
            </>
          )}

          {account && refundEstimate > 0n && (
            <Btn
              label={`Refund ${fmtEth(refundEstimate)}`}
              kind="warn"
              onClick={() => run(`Refund ${fmtEth(refundEstimate)}`, () => writeContract.refund(c.id), "Refunded.")}
            />
          )}
          {account && me.refunded && <p className="ok small">You have been refunded.</p>}
          {c.state === 3 && <p className="ok small">All milestones delivered and paid. 🎉</p>}

          {error && <p className="error">{error}</p>}
          {info && <p className="ok small">{info}</p>}
        </div>
      </div>

      <h2>Milestones</h2>
      <div className="milestones">
        {milestones.map((m, i) => {
          const total = m.yesWeight + m.noWeight;
          const turnout = c.totalRaised > 0n ? Number((total * 10000n) / c.totalRaised) / 100 : 0;
          const yesPct = total > 0n ? Number((m.yesWeight * 10000n) / total) / 100 : 0;
          return (
            <div key={i} className={`card milestone ${i === c.currentMilestone && c.state === 1 ? "current" : ""}`}>
              <div className="card-top">
                <b>
                  #{i + 1} {m.description}
                </b>
                <span className={`state ms-${MilestoneStatus[m.status]}`}>{MilestoneStatus[m.status]}</span>
              </div>
              <div className="row small">
                <span>{fmtEth(m.amount)}</span>
                {m.status >= 1 && (
                  <span className="muted">
                    yes {fmtEth(m.yesWeight)} · no {fmtEth(m.noWeight)} · turnout {turnout}% (quorum 30%)
                  </span>
                )}
              </div>
              {m.status >= 1 && total > 0n && (
                <div className="votebar">
                  <div className="yes" style={{ width: `${yesPct}%` }} />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
