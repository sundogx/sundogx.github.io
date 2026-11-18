// The C interface of compiled.wasm (built by build.sh). Based on src/dds/dds_wrapper.c of @bridge-tools/dd 0.2.2
// (MIT, see LICENSE-bridge-tools.txt), with dds_reset added. DDS is by Bo Haglund and Soren Hein (Apache-2.0).
#include <string.h>
#include <emscripten/emscripten.h>
#include "dds.h"
#include "Memory.h"

extern Memory memory;

extern "C" {

// One thread, a small transposition table (DDS picks TransTableS for the 50 MB it is told it has; System.cpp).
EMSCRIPTEN_KEEPALIVE int dds_init()
{
  SetResources(40, 1);
  return 0;
}

// Forget the previous deal, so the next solve starts with an empty transposition table. Not needed for
// correct results (DDS keeps the table only for the same or a similar deal, as it does in its own batch
// calls), but available to rule the table out when testing.
EMSCRIPTEN_KEEPALIVE void dds_reset()
{
  ThreadData * thrp = memory.GetPtr(0);
  memset(thrp->suit, 0, sizeof(thrp->suit));
  thrp->trump = -1;
}

// Solves the position for the player on lead to the current trick (direction, 0 = N) with up to three cards
// already played to it (suit 0-3 = S H D C, rank 2-14; rank 0 = none). deal is PBN ("N:AKQ.. ..."), the
// remaining cards. output_array receives (rank, suit, tricks) for every card of the player to move, one
// card per run of equals. Returns the number of nodes searched.
EMSCRIPTEN_KEEPALIVE int dds_solve_board(int trump, int direction,
  int card0_suit, int card0_rank, int card1_suit, int card1_rank, int card2_suit, int card2_rank,
  char * deal, int * output_array)
{
  struct dealPBN d;
  d.trump = trump;
  d.first = direction;
  d.currentTrickSuit[0] = card0_suit; d.currentTrickRank[0] = card0_rank;
  d.currentTrickSuit[1] = card1_suit; d.currentTrickRank[1] = card1_rank;
  d.currentTrickSuit[2] = card2_suit; d.currentTrickRank[2] = card2_rank;
  size_t n = strlen(deal);
  if (n >= sizeof(d.remainCards)) n = sizeof(d.remainCards) - 1;
  memcpy(d.remainCards, deal, n);
  d.remainCards[n] = 0;

  struct futureTricks result;
  int ret = SolveBoardPBN(d, 0, 3, 1, &result, 0);
  if (ret != RETURN_NO_FAULT) return ret < 0 ? ret : -1;
  for (int i = 0; i < result.cards; i++) {
    output_array[i * 3] = result.rank[i];
    output_array[i * 3 + 1] = result.suit[i];
    output_array[i * 3 + 2] = result.score[i];
  }
  if (result.cards < 13) output_array[result.cards * 3] = 0; // end of the list
  return result.nodes;
}

}
