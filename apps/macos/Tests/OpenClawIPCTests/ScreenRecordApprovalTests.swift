import CoreGraphics
import Foundation
@preconcurrency import ScreenCaptureKit
import Testing
@testable import OpenClaw

@MainActor
struct ScreenRecordApprovalTests {
    @Test func `approval generation advances only when the first source becomes pending`() {
        let state = ApprovalPromptState()
        let panel = UUID()
        let queue = UUID()
        let initial = state.pendingGeneration

        state.setPending(true, source: panel)
        #expect(state.pendingGeneration == initial + 1)
        state.setPending(true, source: panel)
        state.setPending(true, source: queue)
        #expect(state.pendingGeneration == initial + 1)
        state.setPending(false, source: panel)
        #expect(state.pendingGeneration == initial + 1)
        state.setPending(false, source: queue)
        #expect(state.pendingGeneration == initial + 1)
        state.setPending(true, source: queue)
        #expect(state.pendingGeneration == initial + 2)
    }

    @Test func `recording detects an approval that opened and closed during capture`() throws {
        let state = ApprovalPromptState()
        let source = UUID()
        try state.checkScreenCapture(excludesApplication: false)
        let start = state.pendingGeneration
        try state.checkScreenRecording(excludesApplication: false, startedAtGeneration: start)

        state.setPending(true, source: source)
        state.setPending(false, source: source)
        do {
            try state.checkScreenRecording(excludesApplication: false, startedAtGeneration: start)
            Issue.record("Expected recording to refuse a dismissed approval")
        } catch let ComputerActionService.ComputerActionError.refused(message) {
            #expect(message == "A human approval prompt is open on this Mac; wait for the user to answer it")
        }
        try state.checkScreenRecording(excludesApplication: true, startedAtGeneration: start)
    }

    @Test func `recording refuses a pending approval even at the current generation`() throws {
        let state = ApprovalPromptState()
        state.setPending(true, source: UUID())
        let generation = state.pendingGeneration
        #expect(throws: ComputerActionService.ComputerActionError.self) {
            try state.checkScreenRecording(excludesApplication: false, startedAtGeneration: generation)
        }
        try state.checkScreenRecording(excludesApplication: true, startedAtGeneration: generation)
    }

    @Test(.enabled("Requires a display, Screen Recording permission, and a host without a shareable app") {
        guard CGPreflightScreenCaptureAccess() else { return false }
        let content = try await SCShareableContent.current
        return !content.displays.isEmpty && !content.applications.contains {
            $0.processID == ProcessInfo.processInfo.processIdentifier
        }
    })
    func `recording refuses a pending approval when the app cannot be excluded`() async {
        let source = UUID()
        ApprovalPromptState.shared.setPending(true, source: source)
        defer { ApprovalPromptState.shared.setPending(false, source: source) }

        await #expect(throws: ComputerActionService.ComputerActionError.self) {
            let result = try await ScreenRecordService().record(
                screenIndex: 0,
                durationMs: 250,
                fps: 1,
                includeAudio: false)
            try FileManager().removeItem(atPath: result.path)
        }
    }
}
