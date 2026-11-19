import { formatEther } from "ethers";

export const CampaignState = ["Funding", "Active", "Failed", "Completed", "Cancelled"];
export const MilestoneStatus = ["Pending", "Voting", "Approved", "Rejected", "Paid"];

export const fmtEth = (wei, digits = 4) => {
  const n = Number(formatEther(wei ?? 0n));
  return `${Number(n.toFixed(digits))} ETH`;
};

export const shortAddr = (a) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "");

export const fmtTime = (ts) => new Date(Number(ts) * 1000).toLocaleString();

export function timeLeft(ts, now) {
  let s = Number(ts) - Number(now);
  if (s <= 0) return "ended";
  const d = Math.floor(s / 86400);
  s %= 86400;
  const h = Math.floor(s / 3600);
  s %= 3600;
  const m = Math.floor(s / 60);
  if (d) return `${d}d ${h}h left`;
  if (h) return `${h}h ${m}m left`;
  return `${m}m ${s % 60}s left`;
}

// Readable messages for the contract's custom errors
const ERROR_TEXT = {
  InvalidMilestones: "Milestones are invalid: 1–10 items, each > 0, sum must equal the goal.",
  InvalidGoal: "Goal must be greater than zero.",
  InvalidDuration: "Duration must be greater than zero.",
  CampaignNotFound: "Campaign not found.",
  WrongCampaignState: "This action is not allowed in the current campaign state.",
  WrongMilestoneStatus: "This action is not allowed for the current milestone status.",
  DeadlinePassed: "The funding deadline has passed.",
  DeadlineNotReached: "Goal not reached and the deadline has not passed yet.",
  ZeroContribution: "Contribution must be greater than zero.",
  NotCreator: "Only the campaign creator can do this.",
  NotInvestor: "Only investors of this campaign can vote.",
  AlreadyVoted: "You have already voted on this milestone.",
  VotingClosed: "Voting for this milestone has ended.",
  VotingNotEnded: "Voting has not ended yet.",
  NothingToRefund: "Nothing to refund for this account.",
  TransferFailed: "ETH transfer failed.",
  CreatorCannotVote: "The creator cannot vote on their own milestones.",
  NotStalled: "The creator still has time to submit this milestone.",
};

export function decodeError(err, iface) {
  if (err?.code === "ACTION_REJECTED" || err?.code === 4001) return "Transaction rejected in wallet.";
  let name = err?.revert?.name;
  if (!name && iface) {
    const data = err?.data || err?.info?.error?.data || err?.error?.data;
    try {
      name = iface.parseError(typeof data === "string" ? data : data?.data)?.name;
    } catch {
      /* not a contract error */
    }
  }
  if (name) return ERROR_TEXT[name] || name;
  return err?.shortMessage || err?.reason || err?.message || "Unknown error";
}
