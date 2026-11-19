import Foundation
import Observation
import OpenClawKit

/// Presentation owners publish their pending state; automation never resolves it.
@MainActor
@Observable
final class ApprovalPromptState {
    static let shared = ApprovalPromptState()
    private static let promptRefusal = ComputerActionService.ComputerActionError.refused(
        "A human approval prompt is open on this Mac; wait for the user to answer it")
    private var sources: Set<UUID> = []
    private(set) var pendingGeneration: UInt64 = 0

    var isPending: Bool {
        !self.sources.isEmpty
    }

    func setPending(_ pending: Bool, source: UUID) {
        if pending {
            if self.sources.isEmpty {
                self.pendingGeneration &+= 1
            }
            self.sources.insert(source)
        } else {
            self.sources.remove(source)
        }
    }

    func checkScreenCapture(excludesApplication: Bool) throws {
        if !excludesApplication {
            try self.checkComputerAction(.screenshot)
        }
    }

    func checkScreenRecording(excludesApplication: Bool, startedAtGeneration: UInt64) throws {
        if !excludesApplication, self.isPending || self.pendingGeneration != startedAtGeneration {
            throw Self.promptRefusal
        }
    }

    func checkComputerAction(_ action: OpenClawComputerAction) throws {
        switch action {
        case .listApps, .listWindows, .getCursorPosition:
            return
        default:
            guard !self.isPending else {
                throw Self.promptRefusal
            }
        }
    }
}
