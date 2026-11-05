const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture, time } = require("@nomicfoundation/hardhat-network-helpers");

const ETH = (v) => ethers.parseEther(String(v));
const VOTING_PERIOD = 3 * 24 * 60 * 60; // 3 дня
const DURATION = 7 * 24 * 60 * 60; // 7 дней сбора

// Состояния кампании и этапа (как в enum контракта)
const State = { Funding: 0n, Active: 1n, Failed: 2n, Completed: 3n, Cancelled: 4n };
const MStatus = { Pending: 0n, Voting: 1n, Approved: 2n, Rejected: 3n, Paid: 4n };

describe("MilestoneFund", function () {
  async function deployFixture() {
    const [creator, alice, bob, carol, outsider] = await ethers.getSigners();
    const Fund = await ethers.getContractFactory("MilestoneFund");
    const fund = await Fund.deploy(VOTING_PERIOD);
    return { fund, creator, alice, bob, carol, outsider };
  }

  // Кампания на 10 ETH из 3 этапов: 3 + 3 + 4
  async function campaignFixture() {
    const ctx = await deployFixture();
    await ctx.fund
      .connect(ctx.creator)
      .createCampaign("Open-source drone", ETH(10), DURATION, ["Prototype", "Beta", "Release"], [ETH(3), ETH(3), ETH(4)]);
    return { ...ctx, id: 0n };
  }

  // Кампания собрана: alice 5, bob 3, carol 2 → Active
  async function fundedFixture() {
    const ctx = await campaignFixture();
    const { fund, id, alice, bob, carol } = ctx;
    await fund.connect(alice).contribute(id, { value: ETH(5) });
    await fund.connect(bob).contribute(id, { value: ETH(3) });
    await fund.connect(carol).contribute(id, { value: ETH(2) });
    await fund.finalizeFunding(id);
    return ctx;
  }

  // Проводит голосование по текущему этапу: votes — массив [signer, approve]
  async function runVote(fund, id, creator, votes) {
    await fund.connect(creator).startMilestoneVote(id);
    for (const [signer, approve] of votes) await fund.connect(signer).vote(id, approve);
    await time.increase(VOTING_PERIOD);
    await fund.finalizeMilestone(id);
  }

  describe("Deployment", function () {
    it("stores the voting period", async function () {
      const { fund } = await loadFixture(deployFixture);
      expect(await fund.votingPeriod()).to.equal(VOTING_PERIOD);
      expect(await fund.QUORUM_PERCENT()).to.equal(30);
    });

    it("rejects zero voting period", async function () {
      const Fund = await ethers.getContractFactory("MilestoneFund");
      await expect(Fund.deploy(0)).to.be.revertedWithCustomError(Fund, "InvalidDuration");
    });
  });

  describe("Campaign creation", function () {
    it("creates a campaign and emits CampaignCreated", async function () {
      const { fund, creator } = await loadFixture(deployFixture);
      await expect(
        fund.createCampaign("Title", ETH(3), DURATION, ["A", "B"], [ETH(1), ETH(2)])
      ).to.emit(fund, "CampaignCreated");

      const c = await fund.getCampaign(0);
      expect(c.creator).to.equal(creator.address);
      expect(c.goal).to.equal(ETH(3));
      expect(c.milestoneCount).to.equal(2);
      expect(c.state).to.equal(State.Funding);
      expect((await fund.getMilestone(0, 1)).amount).to.equal(ETH(2));
      expect(await fund.campaignCount()).to.equal(1);
    });

    it("reverts when milestone sum differs from goal", async function () {
      const { fund } = await loadFixture(deployFixture);
      await expect(
        fund.createCampaign("T", ETH(5), DURATION, ["A", "B"], [ETH(1), ETH(2)])
      ).to.be.revertedWithCustomError(fund, "InvalidMilestones");
    });

    it("reverts when arrays have different lengths", async function () {
      const { fund } = await loadFixture(deployFixture);
      await expect(
        fund.createCampaign("T", ETH(3), DURATION, ["A"], [ETH(1), ETH(2)])
      ).to.be.revertedWithCustomError(fund, "InvalidMilestones");
    });

    it("reverts with zero milestones", async function () {
      const { fund } = await loadFixture(deployFixture);
      await expect(fund.createCampaign("T", ETH(1), DURATION, [], [])).to.be.revertedWithCustomError(
        fund,
        "InvalidMilestones"
      );
    });

    it("reverts with more than 10 milestones", async function () {
      const { fund } = await loadFixture(deployFixture);
      const descs = Array.from({ length: 11 }, (_, i) => `M${i}`);
      const amounts = Array(11).fill(ETH(1));
      await expect(fund.createCampaign("T", ETH(11), DURATION, descs, amounts)).to.be.revertedWithCustomError(
        fund,
        "InvalidMilestones"
      );
    });

    it("reverts with zero goal or zero duration", async function () {
      const { fund } = await loadFixture(deployFixture);
      await expect(fund.createCampaign("T", 0, DURATION, ["A"], [0])).to.be.revertedWithCustomError(
        fund,
        "InvalidGoal"
      );
      await expect(fund.createCampaign("T", ETH(1), 0, ["A"], [ETH(1)])).to.be.revertedWithCustomError(
        fund,
        "InvalidDuration"
      );
    });

    it("reverts for unknown campaign id", async function () {
      const { fund } = await loadFixture(deployFixture);
      await expect(fund.getCampaign(5)).to.be.revertedWithCustomError(fund, "CampaignNotFound");
    });
  });

  describe("Contributions", function () {
    it("records contributions and emits Contributed", async function () {
      const { fund, id, alice } = await loadFixture(campaignFixture);
      await expect(fund.connect(alice).contribute(id, { value: ETH(2) }))
        .to.emit(fund, "Contributed")
        .withArgs(id, alice.address, ETH(2));
      await fund.connect(alice).contribute(id, { value: ETH(1) });
      expect(await fund.getContribution(id, alice.address)).to.equal(ETH(3));
      expect((await fund.getCampaign(id)).totalRaised).to.equal(ETH(3));
    });

    it("reverts after the deadline", async function () {
      const { fund, id, alice } = await loadFixture(campaignFixture);
      await time.increase(DURATION);
      await expect(fund.connect(alice).contribute(id, { value: ETH(1) })).to.be.revertedWithCustomError(
        fund,
        "DeadlinePassed"
      );
    });

    it("reverts on zero value", async function () {
      const { fund, id, alice } = await loadFixture(campaignFixture);
      await expect(fund.connect(alice).contribute(id, { value: 0 })).to.be.revertedWithCustomError(
        fund,
        "ZeroContribution"
      );
    });

    it("reverts once funding is finalized (vote weights are frozen)", async function () {
      const { fund, id, outsider } = await loadFixture(fundedFixture);
      await expect(fund.connect(outsider).contribute(id, { value: ETH(100) })).to.be.revertedWithCustomError(
        fund,
        "WrongCampaignState"
      );
    });
  });

  describe("Funding finalization", function () {
    it("moves to Active when the goal is reached (even before deadline)", async function () {
      const { fund, id } = await loadFixture(fundedFixture);
      expect((await fund.getCampaign(id)).state).to.equal(State.Active);
    });

    it("moves to Failed after deadline if the goal is not reached", async function () {
      const { fund, id, alice } = await loadFixture(campaignFixture);
      await fund.connect(alice).contribute(id, { value: ETH(4) });
      await time.increase(DURATION);
      await expect(fund.finalizeFunding(id)).to.emit(fund, "FundingFinalized").withArgs(id, false, ETH(4));
      expect((await fund.getCampaign(id)).state).to.equal(State.Failed);
    });

    it("cannot finalize before deadline if goal not reached", async function () {
      const { fund, id, alice } = await loadFixture(campaignFixture);
      await fund.connect(alice).contribute(id, { value: ETH(4) });
      await expect(fund.finalizeFunding(id)).to.be.revertedWithCustomError(fund, "DeadlineNotReached");
    });
  });

  describe("Voting", function () {
    it("only the creator can start a vote", async function () {
      const { fund, id, alice } = await loadFixture(fundedFixture);
      await expect(fund.connect(alice).startMilestoneVote(id)).to.be.revertedWithCustomError(fund, "NotCreator");
    });

    it("cannot start a vote while still funding", async function () {
      const { fund, id, creator } = await loadFixture(campaignFixture);
      await expect(fund.connect(creator).startMilestoneVote(id)).to.be.revertedWithCustomError(
        fund,
        "WrongCampaignState"
      );
    });

    it("cannot start a second vote on the same milestone", async function () {
      const { fund, id, creator } = await loadFixture(fundedFixture);
      await fund.connect(creator).startMilestoneVote(id);
      await expect(fund.connect(creator).startMilestoneVote(id)).to.be.revertedWithCustomError(
        fund,
        "WrongMilestoneStatus"
      );
    });

    it("non-investors cannot vote", async function () {
      const { fund, id, creator, outsider } = await loadFixture(fundedFixture);
      await fund.connect(creator).startMilestoneVote(id);
      await expect(fund.connect(outsider).vote(id, true)).to.be.revertedWithCustomError(fund, "NotInvestor");
    });

    it("cannot vote twice", async function () {
      const { fund, id, creator, alice } = await loadFixture(fundedFixture);
      await fund.connect(creator).startMilestoneVote(id);
      await fund.connect(alice).vote(id, true);
      await expect(fund.connect(alice).vote(id, false)).to.be.revertedWithCustomError(fund, "AlreadyVoted");
      expect(await fund.hasVotedOn(id, 0, alice.address)).to.equal(true);
    });

    it("cannot vote after voteEnd", async function () {
      const { fund, id, creator, alice } = await loadFixture(fundedFixture);
      await fund.connect(creator).startMilestoneVote(id);
      await time.increase(VOTING_PERIOD);
      await expect(fund.connect(alice).vote(id, true)).to.be.revertedWithCustomError(fund, "VotingClosed");
    });

    it("cannot vote when no vote is open", async function () {
      const { fund, id, alice } = await loadFixture(fundedFixture);
      await expect(fund.connect(alice).vote(id, true)).to.be.revertedWithCustomError(fund, "WrongMilestoneStatus");
    });

    it("vote weight equals contribution", async function () {
      const { fund, id, creator, alice, bob } = await loadFixture(fundedFixture);
      await fund.connect(creator).startMilestoneVote(id);
      await expect(fund.connect(alice).vote(id, true))
        .to.emit(fund, "Voted")
        .withArgs(id, 0, alice.address, true, ETH(5));
      await fund.connect(bob).vote(id, false);
      const m = await fund.getMilestone(id, 0);
      expect(m.yesWeight).to.equal(ETH(5));
      expect(m.noWeight).to.equal(ETH(3));
      expect(m.status).to.equal(MStatus.Voting);
    });

    it("cannot finalize before voteEnd", async function () {
      const { fund, id, creator, alice } = await loadFixture(fundedFixture);
      await fund.connect(creator).startMilestoneVote(id);
      await fund.connect(alice).vote(id, true);
      await expect(fund.finalizeMilestone(id)).to.be.revertedWithCustomError(fund, "VotingNotEnded");
    });

    it("a tie by weight is not a majority: milestone rejected", async function () {
      const { fund, id, creator, alice, bob, carol } = await loadFixture(fundedFixture);
      // alice (5) за, bob (3) + carol (2) против → 5 vs 5 — ничья, этап НЕ одобрен
      await runVote(fund, id, creator, [
        [alice, true],
        [bob, false],
        [carol, false],
      ]);
      expect((await fund.getMilestone(id, 0)).status).to.equal(MStatus.Rejected);
    });
  });

  describe("Quorum", function () {
    it("rejects a milestone when turnout is below 30%, even if all votes are yes", async function () {
      const { fund, id, creator, carol } = await loadFixture(fundedFixture);
      // carol = 2 из 10 ETH = 20% < 30%
      await runVote(fund, id, creator, [[carol, true]]);
      expect((await fund.getMilestone(id, 0)).status).to.equal(MStatus.Rejected);
      expect((await fund.getCampaign(id)).state).to.equal(State.Cancelled);
    });

    it("approves at exactly 30% turnout", async function () {
      const { fund, id, creator, bob } = await loadFixture(fundedFixture);
      // bob = 3 из 10 ETH = ровно 30%
      await runVote(fund, id, creator, [[bob, true]]);
      expect((await fund.getMilestone(id, 0)).status).to.equal(MStatus.Approved);
    });
  });

  describe("Withdrawals", function () {
    it("cannot withdraw before approval", async function () {
      const { fund, id, creator } = await loadFixture(fundedFixture);
      await expect(fund.connect(creator).withdrawMilestone(id)).to.be.revertedWithCustomError(
        fund,
        "WrongMilestoneStatus"
      );
    });

    it("non-creator cannot withdraw", async function () {
      const { fund, id, creator, alice } = await loadFixture(fundedFixture);
      await runVote(fund, id, creator, [[alice, true]]);
      await expect(fund.connect(alice).withdrawMilestone(id)).to.be.revertedWithCustomError(fund, "NotCreator");
    });

    it("full happy path: all milestones approved, creator receives everything", async function () {
      const { fund, id, creator, alice, bob, carol } = await loadFixture(fundedFixture);
      const amounts = [ETH(3), ETH(3), ETH(4)];
      for (let i = 0; i < 3; i++) {
        await runVote(fund, id, creator, [
          [alice, true],
          [bob, true],
          [carol, false],
        ]);
        await expect(fund.connect(creator).withdrawMilestone(id)).to.changeEtherBalances(
          [creator, fund],
          [amounts[i], -amounts[i]]
        );
        expect((await fund.getMilestone(id, i)).status).to.equal(MStatus.Paid);
      }
      const c = await fund.getCampaign(id);
      expect(c.state).to.equal(State.Completed);
      expect(c.released).to.equal(ETH(10));
      expect(await ethers.provider.getBalance(await fund.getAddress())).to.equal(0);
    });

    it("overfunding is paid out with the last milestone", async function () {
      const { fund, creator, alice } = await loadFixture(deployFixture);
      await fund.createCampaign("T", ETH(2), DURATION, ["A", "B"], [ETH(1), ETH(1)]);
      await fund.connect(alice).contribute(0, { value: ETH(3) }); // на 1 ETH больше цели
      await fund.finalizeFunding(0);
      await runVote(fund, 0, creator, [[alice, true]]);
      await fund.withdrawMilestone(0);
      await runVote(fund, 0, creator, [[alice, true]]);
      await expect(fund.withdrawMilestone(0)).to.changeEtherBalance(creator, ETH(2));
    });

    it("cannot withdraw the same milestone twice", async function () {
      const { fund, id, creator, alice } = await loadFixture(fundedFixture);
      await runVote(fund, id, creator, [[alice, true]]);
      await fund.connect(creator).withdrawMilestone(id);
      // текущий этап сдвинулся на следующий (Pending) → вывод невозможен
      await expect(fund.connect(creator).withdrawMilestone(id)).to.be.revertedWithCustomError(
        fund,
        "WrongMilestoneStatus"
      );
    });
  });

  describe("Refunds", function () {
    it("full refund when funding failed", async function () {
      const { fund, id, alice, bob } = await loadFixture(campaignFixture);
      await fund.connect(alice).contribute(id, { value: ETH(4) });
      await fund.connect(bob).contribute(id, { value: ETH(1) });
      await time.increase(DURATION);
      await fund.finalizeFunding(id);
      await expect(fund.connect(alice).refund(id)).to.changeEtherBalance(alice, ETH(4));
      await expect(fund.connect(bob).refund(id)).to.changeEtherBalance(bob, ETH(1));
      expect(await ethers.provider.getBalance(await fund.getAddress())).to.equal(0);
    });

    it("proportional refund of the remainder after a rejected milestone", async function () {
      const { fund, id, creator, alice, bob, carol } = await loadFixture(fundedFixture);
      // этап 1 (3 ETH) одобрен и выплачен
      await runVote(fund, id, creator, [
        [alice, true],
        [bob, true],
      ]);
      await fund.connect(creator).withdrawMilestone(id);
      // этап 2 отклонён
      await runVote(fund, id, creator, [
        [alice, false],
        [bob, false],
        [carol, true],
      ]);
      expect((await fund.getCampaign(id)).state).to.equal(State.Cancelled);

      // остаток 7 ETH делится 5:3:2
      await expect(fund.connect(alice).refund(id))
        .to.emit(fund, "Refunded")
        .withArgs(id, alice.address, ETH(3.5));
      await expect(fund.connect(bob).refund(id)).to.changeEtherBalance(bob, ETH(2.1));
      await expect(fund.connect(carol).refund(id)).to.changeEtherBalance(carol, ETH(1.4));
      expect(await ethers.provider.getBalance(await fund.getAddress())).to.equal(0);
    });

    it("cannot refund twice", async function () {
      const { fund, id, alice } = await loadFixture(campaignFixture);
      await fund.connect(alice).contribute(id, { value: ETH(1) });
      await time.increase(DURATION);
      await fund.finalizeFunding(id);
      await fund.connect(alice).refund(id);
      expect(await fund.isRefunded(id, alice.address)).to.equal(true);
      await expect(fund.connect(alice).refund(id)).to.be.revertedWithCustomError(fund, "NothingToRefund");
    });

    it("cannot refund while the campaign is active", async function () {
      const { fund, id, alice } = await loadFixture(fundedFixture);
      await expect(fund.connect(alice).refund(id)).to.be.revertedWithCustomError(fund, "WrongCampaignState");
    });

    it("non-investors have nothing to refund", async function () {
      const { fund, id, outsider } = await loadFixture(campaignFixture);
      await time.increase(DURATION);
      await fund.finalizeFunding(id);
      await expect(fund.connect(outsider).refund(id)).to.be.revertedWithCustomError(fund, "NothingToRefund");
    });
  });

  describe("Security", function () {
    it("blocks reentrancy on refund", async function () {
      const { fund, id, alice } = await loadFixture(campaignFixture);
      const Attacker = await ethers.getContractFactory("Attacker");
      const attacker = await Attacker.deploy(await fund.getAddress());

      await attacker.invest(id, { value: ETH(2) });
      await fund.connect(alice).contribute(id, { value: ETH(3) });
      await time.increase(DURATION);
      await fund.finalizeFunding(id); // Failed

      await attacker.attack();
      expect(await attacker.reentryAttempts()).to.equal(1);
      expect(await attacker.reentrySucceeded()).to.equal(false);
      // злоумышленник получил только свой вклад, деньги alice на месте
      expect(await ethers.provider.getBalance(await attacker.getAddress())).to.equal(ETH(2));
      expect(await ethers.provider.getBalance(await fund.getAddress())).to.equal(ETH(3));
    });

    it("campaigns are isolated from each other", async function () {
      const { fund, creator, alice, bob } = await loadFixture(deployFixture);
      await fund.createCampaign("A", ETH(1), DURATION, ["x"], [ETH(1)]);
      await fund.createCampaign("B", ETH(1), DURATION, ["y"], [ETH(1)]);
      await fund.connect(alice).contribute(0, { value: ETH(1) });
      await fund.connect(bob).contribute(1, { value: ETH(1) });
      await fund.finalizeFunding(0);
      // alice не может голосовать в кампании B
      await fund.finalizeFunding(1);
      await fund.connect(creator).startMilestoneVote(1);
      await expect(fund.connect(alice).vote(1, true)).to.be.revertedWithCustomError(fund, "NotInvestor");
    });
  });
});
