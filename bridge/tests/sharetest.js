// Deal links, PBN and BBO LIN import (js/share.js). node tests/sharetest.js
const S = require('../js/share.js');
const ok = (c, m) => { if (!c) { console.log('FAIL', m); process.exitCode = 1; } };
// a real BBO LIN record (from the BEN project's card-by-card example), alerts and full play
const LIN = 'md|1S4TKHJD68QC679TKA,S35H479TQKD24TAC8,S2789H3AD379JKC35,|rh||ah|Board 3|sv|e|mb|1C|an|Minor suit opening -- 3+ !C; 11-21 HCP|mb|2H|an|Aggressive weak jump overcall|mb|d|an|Negative double|mb|4H|mb|4S|mb|p|mb|p|mb|p|pg||pc|DA|pc|D3|pc|D5|pc|D6|pg||pc|C8|pc|C3|pc|CJ|pc|CA|pg||pc|S4|pc|S5|pc|S8|pc|SJ|pg||pc|H5|pc|HJ|pc|HQ|pc|HA|pg||pc|S2|pc|SA|pc|ST|pc|S3|pg||pc|H2|pc|SK|pc|H4|pc|H3|pg||pc|D8|pc|D2|pc|DJ|pc|S6|pg||pc|SQ|pc|C6|pc|H7|pc|S7|pg||pc|H8|pc|C7|pc|HK|pc|S9|pg||pc|C5|pc|C2|pc|CT|pc|HT|pg||pc|CK|pc|H9|pc|D7|pc|C4|pg||pc|DQ|pc|D4|pc|DK|pc|H6|pg||pc|D9|pc|CQ|pc|C9|pc|DT|pg||';
const h = S.parseLIN(LIN);
ok(h.board === 3 && h.dealer === 'S' && h.vul === 'EW', 'lin header');
ok(h.contract && h.contract.level === 4 && h.contract.strain === 'S' && h.contract.declarer === 'S', 'lin contract');
ok(h.tricks.length === 13 && h.declTricks === 7 && h.scoreNS === -150, 'lin play ' + h.declTricks);
ok(h.auction[0].alert && /Minor/.test(h.auction[0].alert), 'lin alert');
const url = 'https://www.bridgebase.com/tools/handviewer.html?lin=' + encodeURIComponent(LIN);
ok(JSON.stringify(S.parseAnyDeal(url).tricks) === JSON.stringify(h.tricks), 'handviewer lin url');
ok(S.parseAnyDeal('https://www.bridgebase.com/tools/handviewer.html?n=sakqjhakqjdakqcak&s=s2345h2345d2345c2&e=s6789h6789d6789c3&d=n&v=b&b=7&a=7nppp').contract.level === 7, 'handviewer n/s/e/w url');
const enc = S.shareEncode(h), r = S.shareDecode(enc);
ok(enc.length < 100, 'link length ' + enc.length);
ok(JSON.stringify(r.tricks) === JSON.stringify(h.tricks) && r.declTricks === 7 && r.board === 3 && r.vul === 'EW', 'round trip');
ok(['N', 'E', 'S', 'W'].every(s => r.hands[s].slice().sort().join() === h.hands[s].slice().sort().join()), 'round trip hands');
ok(S.parseAnyDeal('see https://x/bridge/#deal=' + enc).declTricks === 7, 'our link pasted');
// a claim part-way: 4 tricks played, declarer claims 9 in all
const c = S.parseLIN(LIN.replace(/pg\|\|pc\|S2.*$/, 'mc|9|'));
ok(c.tricks.length === 4 && c.declTricks === 9 && S.shareDecode(S.shareEncode(c)).declTricks === 9, 'claim');
// PBN with notes, play in seat columns (board 1 of BEN's Camrose 2024 file)
const PBN = `[Board "1"]\n[Dealer "N"]\n[Vulnerable "None"]\n[Deal "N:T5.982.874.AQ632 K43.73.KQ5.KJT54 AJ9.AQT6.JT62.98 Q8762.KJ54.A93.7"]\n[Declarer "W"]\n[Contract "3S"]\n[Result "9"]\n[Auction "N"]\nPass 1C =1= X =2= XX =3=\nPass 1NT =4= Pass 2S\nPass 3S Pass Pass\nPass\n[Note "1:Clubs"]\n[Play "N"]\nD4 DK D2 D3\n`;
const p = S.parsePBN(PBN);
ok(p.contract && p.contract.declarer === 'W' && p.contract.level === 3 && p.auction.length === 13, 'pbn auction');
ok(p.tricks.length === 1 && p.tricks[0].leader === 'N' && p.declTricks === 9 && p.scoreNS === -140, 'pbn play/result');
const two = '[Event "x"]\n' + PBN + '\n[Event "x"]\n' + PBN.replace('[Board "1"]', '[Board "2"]').replace('[Dealer "N"]', '[Dealer "E"]').replace('[Auction "N"]', '[Auction "E"]');
ok(S.pbnBoards(two).join() === '1,2' && S.parsePBN(two, 1).board === 2 && S.parsePBN(two, 1).dealer === 'E' && S.parsePBN(two).board === 1, 'pbn several boards');
const z = S.parseLIN(LIN.replace('ah|Board 3|', 'ah|Board 0|').replace('md|1', 'md|'));
ok(z.board === 1 && z.dealer === 'N' && z.contract.declarer && z.auction.every(a => a.by), 'lin board 0 (no dealer digit): board 1, dealer N');
let bad = false; try { S.parseAnyDeal('hello'); } catch (e) { bad = true; } ok(bad, 'junk rejected');
console.log(process.exitCode ? 'share: FAILED' : 'share: links, LIN and PBN ok');
