# Soldering, From Scratch

For someone who has never soldered anything. Companion to
[wiring.md](wiring.md) — that one says *what* connects to what, this one says *how* to
actually join it.

---

## 1. What soldering is

Solder is a metal alloy that melts at a low enough temperature for a handheld iron, then
stays solid forever. You use it to fuse a wire to a metal pad so electricity flows and the
wire can't fall off.

It is **not glue**. You don't smear solder across a gap. You heat the *metal parts* until
they're hot enough to melt solder on contact — then the solder flows into and bonds with
both surfaces. That distinction is the entire skill.

---

## 2. Safety

**The tip runs ~350 °C (660 °F)** — hotter than a stove element, and it doesn't look hot.

- **The iron lives in its stand.** Every time you're not actively using it. Never "just for
  a second" on the bench.
- **Never touch the tip to test it.** It stays dangerous for minutes after unplugging.
- **Don't flick or shake the iron** — molten solder flings off. **Wear safety glasses**;
  flux also spits.
- **Ventilate.** The smoke is burning rosin flux, a respiratory irritant. Open a window and
  put a fan beside you blowing smoke *away* from your face.
- **Lead:** the hazard is ingestion, not the smoke (lead doesn't vaporize at these temps).
  No food or drink at the bench, and **wash your hands with soap afterward** — every time.
- **Work on a surface you don't mind marking** — silicone mat, ceramic tile, scrap plywood.
- **Never leave a hot iron unattended.** Unplug when done.

---

## 3. What to buy

You already have wire, heat-shrink, and components. The one place not to cheap out is the
iron — a fixed-temperature $12 pencil is harder to learn on than a $40 adjustable one,
because it runs either too cold to flow or hot enough to cook parts.

| Item | What to get | ~Cost |
|---|---|---|
| **Soldering iron** | Any *temperature-controlled* station, or a Pinecil / TS101. Adjustable temp is the requirement. | $40–60 |
| **Solder** | **63/37 leaded, rosin-core, 0.8 mm** — far easier to learn on than lead-free | $10 |
| **Brass wool tip cleaner** | Better than a wet sponge (doesn't cool the tip) | $6 |
| **Safety glasses** | Any | $5 |
| **Flush cutters** | For trimming wire and component legs | $8 |
| **Wire strippers** | With numbered gauge notches | $10 |
| **Helping hands / PCB holder** | Both your hands are busy — something must hold the work | $10–20 |
| **Desoldering braid** | Copper wick for undoing mistakes | $5 |
| **Isopropyl alcohol 99% + brush** | Cleans flux residue | $8 |
| **Small fan** | Pushes smoke away from your face | — |

Lead-free works fine if you'd rather — run the iron ~30 °C hotter and expect duller joints
that flow less willingly. For a first project, leaded is more forgiving.

---

## 4. Setting up

1. **Set 340 °C (650 °F)** for leaded, 370 °C (700 °F) for lead-free. Hotter is not better —
   above ~400 °C you lift pads off boards and cook parts.
2. **Let it fully heat** — 30–60 s past when it says it's ready.
3. **Tin the tip:** melt a little solder onto it until shiny, wipe on brass wool. Do this at
   the start *and end* of every session.

> **If solder won't stick, 90% of the time the tip is dirty.** A bare tip oxidizes to dull
> grey and stops transferring heat — which feels exactly like a broken iron. Wipe, add
> fresh solder, wipe again.

---

## 5. The one technique that matters

> ### Heat the parts, not the solder.
>
> Touch the iron to **both** the pad and the wire, count to two, then feed solder into the
> far side of the joint — the side the iron *isn't* touching. If the parts are hot enough,
> the solder vanishes into the joint on its own.

**The four steps, about four seconds total:**

1. **Heat both** — iron touches the pad *and* the wire. Count 2.
2. **Feed solder** into the joint, on the side away from the iron.
3. **Solder away** — pull the solder out first, iron still in place.
4. **Iron away** — then hold completely still ~2 s while it sets.

More than ~5 seconds on one joint means something's wrong. Stop, let it cool, retry.

> **The beginner mistake:** melting solder onto the iron and dabbing it on. It looks like it
> worked — there's metal sitting there — but it never bonded to the cold pad. That's a
> **cold joint**, and it's the #1 thing that ruins beginner builds. It'll pass a glance and
> fail a week later.

---

## 6. Good joint vs. bad joint

| | Looks like | Verdict |
|---|---|---|
| **Good** | Shiny, smooth, **concave** — slopes down to the pad like a small volcano | ✅ |
| **Cold** | Dull, grainy, **ball-shaped**, sitting on top without bonding | ❌ Reheat it |
| **Starved** | Too little; wire barely held | ⚠ Add a touch more |
| **Too much** | Big dome hiding the joint; may bridge to neighbours | ⚠ Wick some off |

A good joint curves **inward** (concave). A bad one balls **outward** (convex).

**Two tests:** it should look shiny and smooth, and it should **not move at all** when you
gently tug the wire. If it wiggles, redo it. Reheating costs nothing.

---

## 7. Practice first

**Do not make your first-ever joint on a $6 board.** Twenty minutes on scrap is the
difference between a clean build and a frustrating afternoon.

1. **Tin a wire end** — strip 3 mm, hold the iron to the strands, feed solder. They should
   soak it up and turn silver. Do it ten times until it's boring; this motion is half of
   all soldering.
2. **Join two wires** — tin both, hold together, touch the iron. They fuse instantly. This
   is exactly how the diode goes in.
3. **Practice on ELEGOO spares** — solder a resistor's legs to wire, cut them off, repeat.
4. **Deliberately make a cold joint** — melt solder on the iron and wipe it onto a cold
   wire. See how dull and blobby it is next to a good one. Now you'll recognize it instantly.

---

## 8. The three joints in a beacon

Three wires board→LED, plus one diode spliced into the power wire. See
[wiring.md](wiring.md) for which pin goes where.

**Tin everything first.** Pre-tin both wire ends *and* each pad. Then joining is just: hold
tinned wire on tinned pad, touch the iron a second, they merge. Far easier than heating a
pad, holding a wire, and feeding solder all at once with two hands.

**Wire to the ESP32 board** — hold the tinned wire on the tinned pad with tweezers or tape,
iron for ~1 s, remove, hold still. Don't linger past 3–4 s or you risk lifting the pad off
the board, which isn't repairable.

**Wire to the WS2812B pixel** — ⚠ **be quick, this is the heat-sensitive part.** It's a
plastic lens over a tiny chip; 2–3 seconds is plenty. Park the iron on it and you'll cloud
the lens or kill the controller. If a pad needs another go, **let it cool 30 s first.**

**The diode splice** (inline in the 5 V wire):

1. **Slide the heat-shrink on first** — two pieces, pushed well down the wire. *Everyone
   forgets this.* Solder both ends first and your only options are cutting it apart or
   leaving it bare.
2. Note the **painted band** — that end faces the LED. Backwards and the beacon won't light.
3. Tin the diode legs and both wire ends, hook together, fuse each side.
4. Slide the heat-shrink over each joint and shrink it (heat gun, or a lighter held *near*
   it, not touching).

---

## 9. Fixing mistakes

| Problem | Fix |
|---|---|
| Dull, blobby, or wiggly joint | Iron on it 2 s to re-flow. Add fresh solder — the flux inside helps it wet. |
| Too much solder / bridged pads | Lay desoldering braid over it, press the iron on top; the braid wicks it away. |
| Solder won't stick to the pad | Dirty tip (clean + re-tin), or pad isn't hot enough. Pressing harder does *not* help. |
| Wire came off with the pad attached | Pad lifted from too much heat. On the LED, grab another (you have 100). On the board, use a different pin and update `LED_PIN`. |
| Looks fine, nothing works | Check diode direction first, then that you're on **DIN** not DOUT. Both are more common than a bad joint. |

---

## 10. Finishing up

1. **Clean the joints** with isopropyl to remove sticky flux residue — cosmetic, but it also
   lets you actually inspect them.
2. **Inspect and tug-test** every joint.
3. **Bench-test before enclosing** — USB in, confirm the LED lights and colors look right.
4. **Tin the tip, wipe, unplug**, leave it in the stand to cool.
5. **Wash your hands.**

---

## Quick reference

| Thing | Answer |
|---|---|
| Iron temperature | 340 °C / 650 °F leaded · 370 °C / 700 °F lead-free |
| Time per joint | ~2 s heat, ~1 s solder, ~2 s hold still |
| Too long | More than ~5 s — stop and let it cool |
| Time on the LED | 2–3 s absolute max |
| Where solder goes | Into the joint, away from the iron — never onto the iron |
| Good joint | Shiny, smooth, concave, doesn't move when tugged |
| Heat-shrink | Slide it on *before* soldering the second end |
