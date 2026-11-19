import CoreGraphics
import Foundation
@preconcurrency import ScreenCaptureKit
import Testing
@testable import OpenClaw

@MainActor
struct ScreenRecordApprovalTests {
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
            try FileManager.default.removeItem(atPath: result.path)
        }
    }
}
