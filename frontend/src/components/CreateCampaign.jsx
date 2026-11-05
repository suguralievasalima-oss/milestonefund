import { useState } from "react";
import { formatEther, parseEther } from "ethers";
import { decodeError } from "../utils";

export default function CreateCampaign({ wallet, onCreated, onCancel }) {
  const [title, setTitle] = useState("");
  const [goal, setGoal] = useState("");
  const [minutes, setMinutes] = useState("60");
  const [milestones, setMilestones] = useState([
    { description: "", amount: "" },
    { description: "", amount: "" },
  ]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const update = (i, field, value) =>
    setMilestones((ms) => ms.map((m, j) => (j === i ? { ...m, [field]: value } : m)));

  let sumWei = 0n;
  let goalWei = 0n;
  let parseOk = true;
  try {
    goalWei = goal ? parseEther(goal) : 0n;
    for (const m of milestones) sumWei += m.amount ? parseEther(m.amount) : 0n;
  } catch {
    parseOk = false;
  }
  const sumMatches = parseOk && goalWei > 0n && sumWei === goalWei;

  async function submit(e) {
    e.preventDefault();
    setError("");
    if (!wallet.writeContract) return setError("Connect your wallet first.");
    if (milestones.some((m) => !m.description.trim() || !m.amount)) return setError("Fill in every milestone.");
    if (!sumMatches) return setError("Sum of milestone amounts must equal the goal.");
    setBusy(true);
    try {
      const tx = await wallet.writeContract.createCampaign(
        title.trim(),
        goalWei,
        BigInt(Math.round(Number(minutes) * 60)),
        milestones.map((m) => m.description.trim()),
        milestones.map((m) => parseEther(m.amount))
      );
      const receipt = await tx.wait();
      const log = receipt.logs
        .map((l) => {
          try {
            return wallet.writeContract.interface.parseLog(l);
          } catch {
            return null;
          }
        })
        .find((l) => l?.name === "CampaignCreated");
      onCreated(log ? Number(log.args.id) : null);
    } catch (err) {
      setError(decodeError(err, wallet.writeContract.interface));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="narrow">
      <button className="link" onClick={onCancel}>
        ← Back
      </button>
      <h1>New campaign</h1>
      <form className="card form" onSubmit={submit}>
        <label>
          Title
          <input value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={80} />
        </label>
        <div className="two">
          <label>
            Goal (ETH)
            <input
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              inputMode="decimal"
              required
              placeholder="10"
            />
          </label>
          <label>
            Funding duration (minutes)
            <input type="number" min="1" value={minutes} onChange={(e) => setMinutes(e.target.value)} required />
          </label>
        </div>

        <div className="section-head">
          <h3>Milestones</h3>
          <span className={`small ${sumMatches ? "ok" : "bad"}`}>
            {parseOk ? `Sum: ${formatEther(sumWei)} / ${goal || 0} ETH` : "Invalid number"}
          </span>
        </div>
        {milestones.map((m, i) => (
          <div key={i} className="milestone-row">
            <span className="ms-num">{i + 1}</span>
            <input
              placeholder="What will be delivered"
              value={m.description}
              onChange={(e) => update(i, "description", e.target.value)}
            />
            <input
              className="amount"
              placeholder="ETH"
              inputMode="decimal"
              value={m.amount}
              onChange={(e) => update(i, "amount", e.target.value)}
            />
            <button
              type="button"
              className="btn btn-ghost"
              disabled={milestones.length === 1}
              onClick={() => setMilestones((ms) => ms.filter((_, j) => j !== i))}
              aria-label="Remove milestone"
            >
              ✕
            </button>
          </div>
        ))}
        <button
          type="button"
          className="btn btn-ghost"
          disabled={milestones.length >= 10}
          onClick={() => setMilestones((ms) => [...ms, { description: "", amount: "" }])}
        >
          + Add milestone
        </button>

        {error && <p className="error">{error}</p>}
        <button className="btn btn-primary" disabled={busy || !wallet.account}>
          {busy ? "Confirm in wallet…" : wallet.account ? "Create campaign" : "Connect wallet to create"}
        </button>
      </form>
    </section>
  );
}
