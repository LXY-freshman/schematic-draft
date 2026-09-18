# Netlist dialect conversion

Status: accepted
Primary owner: `packages/spice`

## Runtime integration

`convertNetlist` is a pure TypeScript adaptation of netlist-crawler's MIT
structural translator. It is an in-process function call: editor SCS import
invokes it directly, which is why importing local files works with no service,
HTTP endpoint, Python process, account or simulator involved. Upstream also
exposed it over `POST /api/netlist/convert`; that handler is removed here, since
serving it would require the network this fork does not have. Existing canonical
SPICE/Spectre export printers remain the authority for authored circuit exports.

The call takes text and a dialect pair:

```ts
convertNetlist({
  text: "R1 in out 1k",
  source: "spice",
  target: "spectre",
  fragment: true,
});
```

`source` and `target` accept `spice`, `ngspice`, or `spectre`. SPICE/ngspice are
syntax aliases in this subset. Success returns `status: converted` with `text`,
`source`, `target`, and `issues`. Unsupported input returns `status: blocked` and
diagnostics carrying the original `line`, `statement`, `code`, and `message`; no
partial translated text is returned. Input text is limited to 512 KiB and 10,000
non-comment statements, reported as a `RESOURCE_LIMIT` diagnostic. No input is
stored or executed.

The default is a structural fragment. `fragment: false` recognizes the first
physical line of a SPICE source as its simulator title, and appends `.end` to
SPICE output if absent. Conversion is not a simulator validation or a complete
SPICE/Spectre language implementation.


## Preserved subset

- Ideal two-terminal R/C/L; conventional M/D/Q models; declared or external X
  subcircuits; linear four-node E/G controlled sources.
- Ordered subcircuit interfaces, globals, scalar parameter assignments and
  common arithmetic expressions. Optional Spectre port parentheses are removed
  for SPICE. Numeric suffixes are converted explicitly: Spectre `M` is mega,
  SPICE `M` is milli. Node case aliases that would change meaning are rejected.
- Independent DC and AC sources, complete PULSE and PWL waveforms, and SIN
  waveforms including damping and phase. Missing values or unhandled extras
  cause diagnostics rather than invented values or dropped parameters.
- Simple OP, single-source DC, AC and transient statements. Nested sweeps,
  measurement scripts, options and simulator-specific behavioral expressions
  are outside the native conversion subset.
- Quoted local include paths are retained without opening them. A SPICE model
  or library declaration remains in a `simulator lang=spice` section when
  producing SCS. This does not translate model equations or qualify a library
  for a different simulator. Existing SPICE-language sections in SCS are retained
  as SPICE, including their control text when the target is SPICE.

Native Spectre instance names normally acquire the SPICE device prefix if
needed; collisions block conversion. Declared subcircuits and reviewed SKY130
wrappers use X even when the original name begins with M. Undeclared M/D/Q
references follow conventional model designators. Other external masters need an
explicit X reference or a subcircuit declaration, so unsupported native primitives
are not silently rewritten as subcircuit calls.
The converter does not invent model cards, map arbitrary PDK aliases, infer
physical geometry or search a server's filesystem.

Native conversion of `.control`, unsupported device parameters, native Spectre
model equations, UIC semantics and arbitrary simulator functions is blocked.
SPICE language wrapping never claims to make ngspice control scripts executable
by Spectre. SCS output has not been qualified with licensed Cadence Spectre.

## Import boundary

The File menu accepts `.scs` alongside existing SPICE entries. UTF-8 SCS and
recognizable native Spectre local include files are converted without changing
the original bytes. Include resolution, resource bounds, Project validation and
placement continue through the existing SPICE importer. Unsupported source or
unresolved dependencies leave the active Project unchanged. As with ordinary
SPICE import, this constructs the circuit; it does not retain the deck. Keep the
original files if you need them — import is one-way.

The complete upstream CLI is not embedded. Attribution and the MIT license
are under `packages/spice/third-party/netlist-crawler/`; the conversion source
also carries the license notice for bundled distributions.
