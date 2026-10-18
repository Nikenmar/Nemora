# Synthetic fixtures

Generated inputs that are safe to commit: no real titles, paths or audio from anyone's library.
Tests that need audio generate it at run time (see `crates/nemora-core/tests/identity_corpus.rs`)
instead of storing binary files here, unless a case cannot be reproduced by a generator.

Real profiles and real audio go to `fixtures/private/`, which is gitignored.
