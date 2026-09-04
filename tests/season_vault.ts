import * as anchor from "@coral-xyz/anchor";
import { BN, Program } from "@coral-xyz/anchor";
import { expect } from "chai";
import {
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
} from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createMint,
  getAccount,
  getAssociatedTokenAddressSync,
  getMint,
  mintTo,
  getOrCreateAssociatedTokenAccount,
  transfer,
} from "@solana/spl-token";
import {
  curveSolPda,
  DEFAULT_FEE_BPS,
  DEFAULT_STOCK_PER_SOL,
  marketMakerPda,
  narrativeMintPda,
  positionPda,
  seasonPda,
  stockVaultPda,
  vaultPda,
} from "../scripts/lib";

const STOCK_DECIMALS = 6;

describe("season_vault", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.seasonVault as Program;
  const connection = provider.connection;
  const admin = (provider.wallet as anchor.Wallet).payer;

  let stockMint: PublicKey;
  let vault: PublicKey;
  let stockVault: PublicKey;
  let marketMaker: PublicKey;
  let adminStockAta: PublicKey;

  const airdrop = async (kp: Keypair, sol = 20) => {
    const sig = await connection.requestAirdrop(
      kp.publicKey,
      sol * LAMPORTS_PER_SOL
    );
    const latest = await connection.getLatestBlockhash();
    await connection.confirmTransaction({ signature: sig, ...latest }, "confirmed");
  };

  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  async function setupMintAndVault() {
    stockMint = await createMint(
      connection,
      admin,
      admin.publicKey,
      null,
      STOCK_DECIMALS
    );
    const ata = await getOrCreateAssociatedTokenAccount(
      connection,
      admin,
      stockMint,
      admin.publicKey
    );
    adminStockAta = ata.address;
    await mintTo(
      connection,
      admin,
      stockMint,
      adminStockAta,
      admin,
      1_000_000n * 1_000_000n
    );

    [vault] = vaultPda(stockMint);
    [stockVault] = stockVaultPda(stockMint);
    [marketMaker] = marketMakerPda(stockMint);

    await program.methods
      .initVault(DEFAULT_STOCK_PER_SOL)
      .accounts({
        authority: admin.publicKey,
        stockMint,
        vault,
        stockVaultAta: stockVault,
        marketMakerAta: marketMaker,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    await transfer(
      connection,
      admin,
      adminStockAta,
      marketMaker,
      admin,
      100_000n * 1_000_000n
    );
  }

  async function createSeason(
    index: number,
    name: string,
    durationSecs: number
  ) {
    const [season] = seasonPda(vault, index);
    const [narrativeMint] = narrativeMintPda(vault, index);
    const [curveSol] = curveSolPda(vault, index);
    await program.methods
      .createSeason(name, new BN(durationSecs), DEFAULT_FEE_BPS, 0)
      .accounts({
        authority: admin.publicKey,
        vault,
        season,
        narrativeMint,
        curveSolVault: curveSol,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
    return { season, narrativeMint, curveSol };
  }

  async function buy(
    buyer: Keypair,
    seasonIndex: number,
    lamports: number
  ) {
    const [season] = seasonPda(vault, seasonIndex);
    const [narrativeMint] = narrativeMintPda(vault, seasonIndex);
    const [curveSol] = curveSolPda(vault, seasonIndex);
    const ata = getAssociatedTokenAddressSync(narrativeMint, buyer.publicKey);
    const buyerProgram = new Program(
      program.idl,
      new anchor.AnchorProvider(connection, new anchor.Wallet(buyer), {
        commitment: "confirmed",
      })
    );
    await buyerProgram.methods
      .buy(new BN(lamports))
      .accounts({
        buyer: buyer.publicKey,
        vault,
        season,
        narrativeMint,
        buyerNarrativeAta: ata,
        stockMint,
        stockVaultAta: stockVault,
        marketMakerAta: marketMaker,
        curveSolVault: curveSol,
        feeRecipient: admin.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([buyer])
      .rpc();
    return ata;
  }

  async function close(seasonIndex: number, caller?: Keypair) {
    const [season] = seasonPda(vault, seasonIndex);
    const [narrativeMint] = narrativeMintPda(vault, seasonIndex);
    const signer = caller ?? admin;
    const p =
      signer.publicKey.equals(admin.publicKey)
        ? program
        : new Program(
            program.idl,
            new anchor.AnchorProvider(connection, new anchor.Wallet(signer), {
              commitment: "confirmed",
            })
          );
    await p.methods
      .closeSeason()
      .accounts({
        caller: signer.publicKey,
        vault,
        season,
        stockVaultAta: stockVault,
        narrativeMint,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers(signer.publicKey.equals(admin.publicKey) ? [] : [signer])
      .rpc();
  }

  async function redeem(owner: Keypair, seasonIndex: number) {
    const [season] = seasonPda(vault, seasonIndex);
    const [narrativeMint] = narrativeMintPda(vault, seasonIndex);
    const [position] = positionPda(season, owner.publicKey);
    const ownerNarrativeAta = getAssociatedTokenAddressSync(
      narrativeMint,
      owner.publicKey
    );
    const ownerStockAta = getAssociatedTokenAddressSync(
      stockMint,
      owner.publicKey
    );
    const p = new Program(
      program.idl,
      new anchor.AnchorProvider(connection, new anchor.Wallet(owner), {
        commitment: "confirmed",
      })
    );
    await p.methods
      .redeem()
      .accounts({
        owner: owner.publicKey,
        vault,
        season,
        position,
        narrativeMint,
        ownerNarrativeAta,
        stockMint,
        stockVaultAta: stockVault,
        ownerStockAta,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([owner])
      .rpc();
  }

  async function roll(owner: Keypair, fromIndex: number, toIndex: number) {
    const [season] = seasonPda(vault, fromIndex);
    const [nextSeason] = seasonPda(vault, toIndex);
    const [narrativeMint] = narrativeMintPda(vault, fromIndex);
    const [nextNarrativeMint] = narrativeMintPda(vault, toIndex);
    const [position] = positionPda(season, owner.publicKey);
    const ownerNarrativeAta = getAssociatedTokenAddressSync(
      narrativeMint,
      owner.publicKey
    );
    const ownerNextNarrativeAta = getAssociatedTokenAddressSync(
      nextNarrativeMint,
      owner.publicKey
    );
    const p = new Program(
      program.idl,
      new anchor.AnchorProvider(connection, new anchor.Wallet(owner), {
        commitment: "confirmed",
      })
    );
    await p.methods
      .roll()
      .accounts({
        owner: owner.publicKey,
        vault,
        season,
        nextSeason,
        position,
        narrativeMint,
        nextNarrativeMint,
        ownerNarrativeAta,
        ownerNextNarrativeAta,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([owner])
      .rpc();
  }

  before(async () => {
    await setupMintAndVault();
  });

  it("cannot create a second live season", async () => {
    await createSeason(0, "Robotaxi", 120);
    try {
      await createSeason(1, "FSD", 120);
      expect.fail("expected second live season to fail");
    } catch (e: unknown) {
      const msg = String(e);
      expect(msg).to.match(/SeasonAlreadyLive|already exists/i);
    }
  });

  it("buy fails after end_ts", async () => {
    // Close current live season as admin so we can open a short one.
    await close(0);
    const { narrativeMint } = await createSeason(1, "Short", 2);
    const buyer = Keypair.generate();
    await airdrop(buyer);
    await buy(buyer, 1, LAMPORTS_PER_SOL);
    const ata = getAssociatedTokenAddressSync(narrativeMint, buyer.publicKey);
    const before = await getAccount(connection, ata);
    expect(Number(before.amount)).to.be.greaterThan(0);

    await sleep(2500);
    try {
      await buy(buyer, 1, LAMPORTS_PER_SOL);
      expect.fail("expected buy after expiry to fail");
    } catch (e: unknown) {
      const msg = String(e);
      expect(msg).to.match(/SeasonNotLive|0x1772|expired/i);
    }
  });

  it("anyone can close_season after expiry", async () => {
    const stranger = Keypair.generate();
    await airdrop(stranger, 2);
    await close(1, stranger);
    const [season] = seasonPda(vault, 1);
    const acc = await program.account.season.fetch(season);
    expect(Object.keys(acc.status)[0]).to.equal("closed");
    const v = await program.account.vault.fetch(vault);
    expect(v.liveSeason.toBase58()).to.equal(PublicKey.default.toBase58());
  });

  it("redeem pays pro-rata against snapshot", async () => {
    const alice = Keypair.generate();
    const bob = Keypair.generate();
    await airdrop(alice);
    await airdrop(bob);

    const { season, narrativeMint } = await createSeason(2, "ProRata", 60);
    await buy(alice, 2, LAMPORTS_PER_SOL);
    await buy(bob, 2, 2 * LAMPORTS_PER_SOL);

    const aliceAta = getAssociatedTokenAddressSync(narrativeMint, alice.publicKey);
    const bobAta = getAssociatedTokenAddressSync(narrativeMint, bob.publicKey);
    const aliceTokens = (await getAccount(connection, aliceAta)).amount;
    const bobTokens = (await getAccount(connection, bobAta)).amount;
    const mintSupply = (await getMint(connection, narrativeMint)).supply;
    const vaultStockBefore = (await getAccount(connection, stockVault)).amount;

    await close(2);

    const seasonAcc = await program.account.season.fetch(season);
    expect(seasonAcc.redeemableSupply.toString()).to.equal(mintSupply.toString());
    expect(Number(seasonAcc.redeemableStock)).to.be.greaterThan(0);

    await redeem(alice, 2);
    const aliceStockAta = getAssociatedTokenAddressSync(stockMint, alice.publicKey);
    const aliceStock = (await getAccount(connection, aliceStockAta)).amount;
    const expected =
      (seasonAcc.redeemableStock.toNumber() * Number(aliceTokens)) /
      Number(mintSupply);
    // Integer division on-chain; allow 1 base-unit of rounding vs JS float.
    expect(Number(aliceStock)).to.be.closeTo(Math.floor(expected), 1);

    // Snapshot isolation: redeem uses frozen numbers, not live ATA after later seasons.
    expect(Number(aliceTokens) + Number(bobTokens)).to.equal(Number(mintSupply));
    expect(Number(vaultStockBefore)).to.equal(seasonAcc.redeemableStock.toNumber());
  });

  it("double redeem fails", async () => {
    const alice = Keypair.generate();
    await airdrop(alice);
    // Season 2 is closed; alice from previous test already redeemed. Use a fresh season.
    const carol = Keypair.generate();
    await airdrop(carol);
    await createSeason(3, "Double", 60);
    await buy(carol, 3, LAMPORTS_PER_SOL);
    await close(3);
    await redeem(carol, 3);
    try {
      await redeem(carol, 3);
      expect.fail("expected double redeem to fail");
    } catch (e: unknown) {
      const msg = String(e);
      expect(msg).to.match(/AlreadyRedeemed|AlreadyRolled|NoTokens|0x177b|0x177c|0x177d/i);
    }
  });

  it("roll mints next-season tokens and burns old", async () => {
    const dave = Keypair.generate();
    await airdrop(dave);
    const { narrativeMint: oldMint } = await createSeason(4, "RollFrom", 60);
    await buy(dave, 4, LAMPORTS_PER_SOL);
    const oldAta = getAssociatedTokenAddressSync(oldMint, dave.publicKey);
    const oldAmount = (await getAccount(connection, oldAta)).amount;
    expect(Number(oldAmount)).to.be.greaterThan(0);

    await close(4);
    const { narrativeMint: newMint } = await createSeason(5, "FSD", 60);
    await roll(dave, 4, 5);

    const oldAfter = await getAccount(connection, oldAta);
    expect(Number(oldAfter.amount)).to.equal(0);
    const newAta = getAssociatedTokenAddressSync(newMint, dave.publicKey);
    const newAmount = (await getAccount(connection, newAta)).amount;
    expect(newAmount).to.equal(oldAmount);
  });

  it("redeem + roll cannot both succeed for the same tokens", async () => {
    const eve = Keypair.generate();
    await airdrop(eve);
    // close season 5 first
    await close(5);
    await createSeason(6, "XorFrom", 60);
    await buy(eve, 6, LAMPORTS_PER_SOL);
    await close(6);
    await createSeason(7, "XorTo", 60);

    await redeem(eve, 6);
    try {
      await roll(eve, 6, 7);
      expect.fail("expected roll after redeem to fail");
    } catch (e: unknown) {
      const msg = String(e);
      expect(msg).to.match(/AlreadyRedeemed|AlreadyRolled|NoTokens|0x177b|0x177c|0x177d/i);
    }
  });

  it("vault stock only decreases on redeem, not on roll", async () => {
    const frank = Keypair.generate();
    const gina = Keypair.generate();
    await airdrop(frank);
    await airdrop(gina);

    await close(7);
    const { season } = await createSeason(8, "StockPath", 60);
    await buy(frank, 8, LAMPORTS_PER_SOL);
    await buy(gina, 8, LAMPORTS_PER_SOL);
    await close(8);

    const before = (await getAccount(connection, stockVault)).amount;
    await createSeason(9, "Next", 60);

    await roll(frank, 8, 9);
    const afterRoll = (await getAccount(connection, stockVault)).amount;
    expect(afterRoll).to.equal(before);

    await redeem(gina, 8);
    const afterRedeem = (await getAccount(connection, stockVault)).amount;
    expect(Number(afterRedeem)).to.be.lessThan(Number(afterRoll));

    const seasonAcc = await program.account.season.fetch(season);
    expect(Object.keys(seasonAcc.status)[0]).to.equal("settled");
  });
});
