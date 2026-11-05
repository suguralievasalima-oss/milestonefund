// Выполняет шаги демо-сценария для кампании #0 без MetaMask, от имени тестовых аккаунтов Hardhat.
// Использование (PowerShell):
//   $env:DEMO_STEP="start-vote"; npx.cmd hardhat run scripts/demo.js --network localhost
// Шаги: start-vote | approve | reject | finalize | withdraw | refund | status
//   approve / reject — голосуют инвесторы #1 и #2
//   refund           — возврат всем инвесторам (#1, #2, #3)
const hre = require("hardhat");
const deployment = require("../frontend/src/contract/MilestoneFund.json");

const STATES = ["Funding", "Active", "Failed", "Completed", "Cancelled"];
const STATUSES = ["Pending", "Voting", "Approved", "Rejected", "Paid"];

async function status(fund, id) {
  const { ethers } = hre;
  const c = await fund.getCampaign(id);
  console.log(`Campaign #${id} "${c.title}": ${STATES[Number(c.state)]}, released ${ethers.formatEther(c.released)} ETH`);
  for (let i = 0; i < Number(c.milestoneCount); i++) {
    const m = await fund.getMilestone(id, i);
    console.log(
      `  #${i + 1} ${m.description}: ${STATUSES[Number(m.status)]}` +
        ` (yes ${ethers.formatEther(m.yesWeight)} / no ${ethers.formatEther(m.noWeight)} ETH)`
    );
  }
}

async function main() {
  const { ethers } = hre;
  const step = process.env.DEMO_STEP || "status";
  const id = Number(process.env.CAMPAIGN_ID || 0);
  const [creator, inv1, inv2, inv3] = await ethers.getSigners();
  const fund = await ethers.getContractAt("MilestoneFund", deployment.address);
  const send = async (label, txPromise) => {
    await (await txPromise).wait();
    console.log(`✔ ${label}`);
  };

  switch (step) {
    case "start-vote":
      await send(`creator ${creator.address} started milestone vote`, fund.connect(creator).startMilestoneVote(id));
      break;
    case "approve":
    case "reject": {
      const approve = step === "approve";
      for (const s of [inv1, inv2]) await send(`${s.address} voted ${approve ? "YES" : "NO"}`, fund.connect(s).vote(id, approve));
      break;
    }
    case "finalize":
      await send("vote finalized", fund.finalizeMilestone(id));
      break;
    case "withdraw":
      await send("creator withdrew milestone funds", fund.connect(creator).withdrawMilestone(id));
      break;
    case "refund":
      for (const s of [inv1, inv2, inv3]) await send(`${s.address} refunded`, fund.connect(s).refund(id));
      break;
    case "status":
      break;
    default:
      throw new Error(`Unknown DEMO_STEP "${step}"`);
  }
  await status(fund, id);
}

main().catch((e) => {
  console.error(e.shortMessage || e.message);
  process.exitCode = 1;
});
