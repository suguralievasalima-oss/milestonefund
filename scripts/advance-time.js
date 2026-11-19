// Moves the local network clock forward. Usage (PowerShell):
//   $env:ADVANCE_SECONDS="600"; npx hardhat run scripts/advance-time.js --network localhost
const hre = require("hardhat");

async function main() {
  const seconds = Number(process.env.ADVANCE_SECONDS || 600);
  await hre.network.provider.send("evm_increaseTime", [seconds]);
  await hre.network.provider.send("evm_mine");
  const block = await hre.ethers.provider.getBlock("latest");
  console.log(`Advanced ${seconds} s. Chain time: ${new Date(block.timestamp * 1000).toISOString()}`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
