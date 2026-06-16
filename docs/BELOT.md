# Belot for Two Players

This implementation is a two-player digital adaptation of Belot using the existing 32-card Hungarian deck:

- Suits: acorns, bells, hearts, leaves
- Ranks: VII, VIII, IX, X, U/J, O/Q, K, A

Each hand has one trump suit. Players take tricks, score card points, score submitted declarations, and add the final hand score to their running game score. There are no teams.

## Game Objective

The game continues until at least one player reaches 501 points after a completed hand.

If only one player has at least 501 points, that player wins. If both players reach at least 501 points in the same hand, the higher total score wins. If both totals are tied, play continues until there is a difference.

## Dealer and First Player

The initial dealer is selected randomly. The dealer alternates after every hand. The non-dealer is the first player for the hand.

The first player:

- Acts first during trump selection
- Leads the first trick
- Must choose trump on mus if both players pass both normal trump rounds

## Deal

At the start of each hand, the server shuffles the 32-card deck.

Each player receives 8 cards in hand. Each player also receives 2 hidden table cards that belong to that player but are not visible yet. One additional card is turned face up for the first trump-selection round. The remaining 11 cards are unused and hidden.

After trump is selected, each player takes their 2 hidden cards into hand, giving each player 10 cards. The upcard never enters play, cannot be played, and cannot be used in declarations.

This version does not support exchanging the trump VII for the upcard.

## Trump Selection

Trump selection has up to three phases.

In round one, the first player and then the second player may accept the upcard suit as trump. The first acceptance selects trump and identifies the caller.

If both pass, round two starts. The first player and then the second player may choose one of the other three suits. The upcard suit cannot be chosen in round two.

If both pass again, the first player is on mus and must choose a trump suit other than the upcard suit. The mus player is the caller.

## Card Ranking and Points

Non-trump ranking from strongest to weakest:

1. A
2. X
3. K
4. O/Q (lady/queen)
5. U/J (boy/jack)
6. IX
7. VIII
8. VII

Non-trump point values:

| Rank             | Points |
| ---------------- | -----: |
| A                |     11 |
| X                |     10 |
| K                |      4 |
| O/Q (lady/queen) |      3 |
| U/J (boy/jack)   |      2 |
| IX, VIII, VII    |      0 |

Trump ranking from strongest to weakest:

1. U/J (boy/jack)
2. IX
3. A
4. X
5. K
6. O/Q (lady/queen)
7. VIII
8. VII

Trump point values:

| Rank             | Points |
| ---------------- | -----: |
| U/J (boy/jack)   |     20 |
| IX               |     14 |
| A                |     11 |
| X                |     10 |
| K                |      4 |
| O/Q (lady/queen) |      3 |
| VIII, VII        |      0 |

## Declarations

Declarations are determined after players pick up their hidden cards. In this version, the official client automatically chooses declarations and sends them to the server.

The server does not choose optimal declarations. It only validates that submitted declarations are possible, legal, and non-overlapping. If a player submits a weaker but valid declaration set, those submitted declarations are what score.

The server waits for both players to submit declarations. Trick play starts only after both submissions are received and validated. Cards used in accepted declarations become public to both players while still in hand.

### Declaration Types

Belote: trump K and trump O/Q together score 20 points. These two cards may also be used in one ordinary declaration.

Sequences in one suit use this order: VII, VIII, IX, X, U/J, O/Q, K, A.

| Sequence                    | Points |
| --------------------------- | -----: |
| 3 consecutive cards         |     20 |
| 4 consecutive cards         |     50 |
| 5 or more consecutive cards |    100 |

There is no automatic win for an 8-card sequence.

Four-of-kind declarations:

| Declaration | Points |
| ----------- | -----: |
| Four U/J    |    200 |
| Four IX     |    150 |
| Four A      |    100 |
| Four X      |    100 |
| Four K      |    100 |
| Four O/Q    |    100 |

Four VII and four VIII do not score.

### Overlap Rules

A physical card may participate in at most one ordinary declaration. The exception is belote: trump K and trump O/Q may participate in belote and one ordinary declaration.

The official client generates all possible valid declarations, then chooses the set with the highest bonus total under the overlap rules. If totals tie, it chooses the set that reveals fewer cards, then the set with the strongest single declaration, then a deterministic suit/rank order.

The deterministic suit order is acorns, bells, hearts, leaves. The deterministic rank order is VII, VIII, IX, X, U/J, O/Q, K, A.

## Trick Play

Each hand has 10 tricks. The first player leads the first trick. After that, the winner of the previous trick leads the next trick.

Rules for playing a card:

- A player who can follow the lead suit must follow with any card of that suit.
- A player who cannot follow suit but has trump must play any trump.
- A player who cannot follow suit and has no trump may play any card.

If any trump was played, the strongest trump wins the trick. Otherwise, the strongest card in the lead suit wins.

## Hand Scoring

Game points are the points from captured cards. The winner of the last trick receives 10 additional game points.

Declaration points are added after game points:

```text
I_c = caller game points
B_c = caller declaration points
T_c = I_c + B_c

I_o = opponent game points
B_o = opponent declaration points
T_o = I_o + B_o
```

The caller succeeds only if `T_c > T_o`. A tie is a fall for the caller.

If the caller succeeds:

```text
caller_score = T_c
opponent_score = T_o
```

If the caller falls by total points but is still better in card play:

```text
T_c <= T_o
I_c > I_o

caller_score = 0
opponent_score = T_o
```

If the caller falls by total points and also does not beat the opponent in card play:

```text
T_c <= T_o
I_c <= I_o

caller_score = 0
opponent_score = T_o + T_c
```

If the caller was on mus and also fell on card play:

```text
T_c <= T_o
I_c <= I_o
mus = true

caller_score = -20
opponent_score = T_o
```

The mus exception does not apply when the caller only falls because of declarations while still having more card-play points.

## Schuster

A player who wins no tricks in a hand is schuster. A schuster player's declaration points do not count for that player; they are added to the other player's hand score instead. After that scoring transfer, each schuster player receives an additional -100 points for that hand. Game totals may become negative.

## Server Responsibilities

The server is authoritative for shuffling, dealing, trump selection, game state, legal card play, declaration validation, public-card publication, trick winners, hand scoring, and game completion.

The server validates that:

- Declared cards are in the declaring player's hand
- Each declaration has a valid type and point value
- Declaration card overlap is legal
- Belote uses trump K and trump O/Q
- The upcard and unused cards cannot be declared

The server does not validate that a declaration set is optimal.

## Client Responsibilities

The client displays the player's private hand, public declaration cards, the current trick, declarations, hand results, and total scores.

In this version, the official client automatically selects the maximum valid declaration set and submits it. Future versions may allow manual declaration selection while keeping server validation unchanged.

## Excluded From This Version

This version does not support:

- Exchanging trump VII for the upcard
- Putting the upcard into play
- Using the unused deck remainder
- Automatic win for an 8-card sequence
- Manual declaration selection
- Team play
- Three-player or four-player Belot
