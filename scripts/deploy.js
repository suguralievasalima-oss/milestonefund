const fs = require("fs");
const path = require("path");
const hre = require("hardhat");

async function main() {
  const { ethers, network } = hre;
  // Период голосования: из .env (VOTING_PERIOD, сек), иначе 5 минут для localhost и 3 дня для остальных сетей
  const defaultPeriod = network.name === "localhost" || network.name === "hardhat" ? 300 : 3 * 24 * 60 * 60;
  const votingPeriod = Number(process.env.VOTING_PERIOD || defaultPeriod);

  const [deployer] = await ethers.getSigners();
  console.log(`Network: ${network.name}`);
  console.log(`Deployer: ${deployer.address}`);
  console.log(`Voting period: ${votingPeriod} s`);

  const fund = await ethers.deployContract("MilestoneFund", [votingPeriod]);
  await fund.waitForDeployment();
  const address = await fund.getAddress();
  console.log(`MilestoneFund deployed to: ${address}`);

  // Сохраняем адрес и ABI для фронтенда
  const artifact = await hre.artifacts.readArtifact("MilestoneFund");
  const { chainId } = await ethers.provider.getNetwork();
  const outDir = path.join(__dirname, "..", "frontend", "src", "contract");
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(
    path.join(outDir, "MilestoneFund.json"),
    JSON.stringify({ address, chainId: Number(chainId), network: network.name, abi: artifact.abi }, null, 2)
  );
  console.log(`Saved address and ABI to frontend/src/contract/MilestoneFund.json`);

  if (network.name !== "localhost" && network.name !== "hardhat") {
    console.log(`\nVerify with:\n  npx hardhat verify --network ${network.name} ${address} ${votingPeriod}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
