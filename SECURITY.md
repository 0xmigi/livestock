# Security policy

Livestock is a Solana program that holds tokenized stock in vaults on users'
behalf. Bugs in it can cost real money, so we want to hear about them first.

Program: `5X7RTCFFLgCpsRiskzm1gBEQmbzBEL39H6WpN9YzSizB` (devnet and mainnet).
The deployed binary embeds a `security.txt` that points here.

## Reporting

- Open a private advisory: https://github.com/0xmigi/livestock/security/advisories/new
- Or DM https://x.com/livestock_gg

Please include the program version or commit, the instruction involved, and a
way to reproduce (a LiteSVM test in the style of `programs/livestock/tests` is
ideal). We aim to acknowledge within 48 hours and to fix a confirmed critical
issue before public disclosure.

## Scope

In scope: the on-chain program under `programs/livestock`, the TypeScript
client under `client`, and the keeper under `scripts`. The web app is in scope
where a bug there can move funds.

Out of scope: issues in third-party programs the vault depends on (SPL Token,
Token-2022, the tokenized-stock issuer's freeze authority), pricing of the
underlying stock, and social engineering.

## Safe harbour

Good-faith research that stays within scope, does not touch other users'
funds, and gives us time to fix will not be met with legal action. There is no
bounty programme yet; we will credit reporters in this file and in the
program's embedded `security.txt`.
