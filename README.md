# Childhood Games

Incomplete remnants of games I made in Game Maker 5 between 2004 and 2006, found on an old hard drive and rebuilt for the web.

**Play:** https://xseb0.github.io/childhood-games/

- **Goombas adventure** (January 2004): a platformer. Also as a "complete" version with the fire flower and the underground that were in the file but never placed.
- **Evil Tomtenissar** (September 2006): a snowman against evil Christmas elves. Also as a "complete" version with lives, GAME OVER, snow clouds and an unused title snowman.

## How it works

The games run on a small Game Maker 5 engine written in JavaScript (`motor/`). It reads each game's own data, extracted from the original `.exe` files into `data/`: sprites, backgrounds, sounds, MIDI music, rooms, objects and the original GML code. The "complete" versions are small patches in `varianter/` that are applied when the game loads, without changing the original data.

Played with a keyboard. Goombas adventure uses sprites from Nintendo games, as kids' fan games did back then.
