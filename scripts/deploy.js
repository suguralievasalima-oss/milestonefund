const fs = require("fs");
const path = require("path");
const hre = require("hardhat");

async function main() {
  const { ethers, network } = hre;
  // Periods come from .env (VOTING_PERIOD, SUBMISSION_PERIOD, seconds). Defaults on localhost:
  // 5-minute votes and a 1-hour submission deadline; on other networks 3 and 30 days.
  const local = network.name === "localhost" || network.name === "hardhat";
  const votingPeriod = Number(process.env.VOTING_PERIOD || (local ? 300 : 3 * 24 * 60 * 60));
  const submissionPeriod = Number(process.env.SUBMISSION_PERIOD || (local ? 3600 : 30 * 24 * 60 * 60));

  const [deployer] = await ethers.getSigners();
  console.log(`Network: ${network.name}`);
  console.log(`Deployer: ${deployer.address}`);
  console.log(`Voting period: ${votingPeriod} s, submission period: ${submissionPeriod} s`);

  const fund = await ethers.deployContract("MilestoneFund", [votingPeriod, submissionPeriod]);
  await fund.waitForDeployment();
  const address = await fund.getAddress();
  console.log(`MilestoneFund deployed to: ${address}`);

  // Save the address and ABI for the frontend
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
    console.log(
      `\nVerify with:\n  npx hardhat verify --network ${network.name} ${address} ${votingPeriod} ${submissionPeriod}`
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
