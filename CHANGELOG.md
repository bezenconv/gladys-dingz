# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

## [0.1.0] - 2026-11-01

### Added

- Discovery of the dingz through their UDP announcements (port 7979), plus
  addresses entered by hand.
- One device per dingz: lights and dimmers, other outputs as switches, blinds
  (open / close / stop, position, slats), temperature, light level, motion
  and power per output.
- Fast follow-up reads after a command, until a blind stops moving.
- Configuration actions: search and test the dingz, identify a dingz by
  blinking its LED.

[Unreleased]: https://github.com/bezenconv/gladys-dingz/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/bezenconv/gladys-dingz/releases/tag/v0.1.0
