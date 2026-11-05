// Создаёт демо-кампании на localhost, чтобы во фронтенде было что показать
const hre = require("hardhat");
const deployment = require("../frontend/src/contract/MilestoneFund.json");

async function main() {
  const { ethers } = hre;
  const [creator, alice, bob, carol] = await ethers.getSigners();
  const fund = await ethers.getContractAt("MilestoneFund", deployment.address);
  const E = (v) => ethers.parseEther(String(v));
  const DAY = 24 * 60 * 60;

  // 1) Уже собранная кампания — можно сразу голосовать по этапам
  await (await fund.connect(creator).createCampaign(
    "Open-source weather station",
    E(10),
    7 * DAY,
    ["Working prototype", "Field test in 3 cities", "Public release + docs"],
    [E(3), E(3), E(4)]
  )).wait();
  await (await fund.connect(alice).contribute(0, { value: E(5) })).wait();
  await (await fund.connect(bob).contribute(0, { value: E(3) })).wait();
  await (await fund.connect(carol).contribute(0, { value: E(2) })).wait();
  await (await fund.finalizeFunding(0)).wait();

  // 2) Кампания в процессе сбора
  await (await fund.connect(bob).createCampaign(
    "Community library app",
    E(6),
    3 * DAY,
    ["MVP", "Mobile version"],
    [E(2), E(4)]
  )).wait();
  await (await fund.connect(alice).contribute(1, { value: E(1.5) })).wait();

  console.log("Seeded 2 campaigns:");
  console.log("  #0 Active (10 ETH raised) — creator:", creator.address);
  console.log("  #1 Funding (1.5 / 6 ETH)   — creator:", bob.address);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
