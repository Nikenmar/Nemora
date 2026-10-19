//! Builds the vendored Signalsmith Stretch (speed without a change of pitch) behind its C wrapper.

fn main() {
    let vendor = std::path::Path::new("vendor/signalsmith");
    println!("cargo::rerun-if-changed=vendor/signalsmith");
    cc::Build::new()
        .cpp(true)
        .std("c++14")
        .file(vendor.join("wrapper/wrapper.cpp"))
        .include(vendor)
        .include(vendor.join("signalsmith-stretch"))
        // The stretcher runs on the player thread in real time, so it is optimised in every
        // profile; an unoptimised build cannot keep up.
        .opt_level(3)
        .define("NDEBUG", None)
        .warnings(false)
        .compile("signalsmith-stretch");
}
