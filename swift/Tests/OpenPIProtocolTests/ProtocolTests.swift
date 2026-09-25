import XCTest
@testable import OpenPIProtocol

final class ProtocolTests: XCTestCase {
    func testJSONLinesCodecChunking() throws {
        let chunk1 = "{\"id\":\"1\",\"type\":\"health\"}\n{\"id\":\"2\"".data(using: .utf8)!
        let (lines1, rest1) = JSONLinesCodec.decodeLines(buffer: Data(), newChunk: chunk1)

        XCTAssertEqual(lines1.count, 1)
        XCTAssertEqual(String(data: lines1[0], encoding: .utf8), "{\"id\":\"1\",\"type\":\"health\"}")
        XCTAssertEqual(String(data: rest1, encoding: .utf8), "{\"id\":\"2\"")

        let chunk2 = ",\"type\":\"shutdown\"}\n".data(using: .utf8)!
        let (lines2, rest2) = JSONLinesCodec.decodeLines(buffer: rest1, newChunk: chunk2)

        XCTAssertEqual(lines2.count, 1)
        XCTAssertEqual(String(data: lines2[0], encoding: .utf8), "{\"id\":\"2\",\"type\":\"shutdown\"}")
        XCTAssertTrue(rest2.isEmpty)
    }

    func testClientRequestRoundTrip() throws {
        let req = ClientRequest.createSession(
            id: "req_100",
            cwd: "/Users/test/project",
            mode: .code,
            model: "anthropic/claude-3-5-sonnet",
            name: "Test Session",
            inMemory: false
        )

        let encoded = try JSONEncoder().encode(req)
        let decoded = try JSONDecoder().decode(ClientRequest.self, from: encoded)

        XCTAssertEqual(decoded.requestId, "req_100")
        if case .createSession(let id, let cwd, let mode, let model, let name, let inMem) = decoded {
            XCTAssertEqual(id, "req_100")
            XCTAssertEqual(cwd, "/Users/test/project")
            XCTAssertEqual(mode, .code)
            XCTAssertEqual(model, "anthropic/claude-3-5-sonnet")
            XCTAssertEqual(name, "Test Session")
            XCTAssertEqual(inMem, false)
        } else {
            XCTFail("Decoded to wrong request type")
        }
    }

    func testServerMessageRoundTrip() throws {
        let resp = ServerMessage.successResponse(
            id: "req_100",
            data: .object(["status": .string("ok"), "count": .number(42)])
        )

        let encoded = try JSONEncoder().encode(resp)
        let decoded = try JSONDecoder().decode(ServerMessage.self, from: encoded)

        if case .successResponse(let id, let data) = decoded {
            XCTAssertEqual(id, "req_100")
            XCTAssertEqual(data?["status"]?.stringValue, "ok")
            XCTAssertEqual(data?["count"]?.intValue, 42)
        } else {
            XCTFail("Decoded to wrong server message")
        }

        let evt = ServerMessage.event(
            sessionId: "sess_1",
            event: ["type": .string("message_delta"), "content": .string("Hello world")]
        )
        let evtEncoded = try JSONEncoder().encode(evt)
        let evtDecoded = try JSONDecoder().decode(ServerMessage.self, from: evtEncoded)
        if case .event(let sid, let payload) = evtDecoded {
            XCTAssertEqual(sid, "sess_1")
            XCTAssertEqual(payload["type"]?.stringValue, "message_delta")
            XCTAssertEqual(payload["content"]?.stringValue, "Hello world")
        } else {
            XCTFail("Decoded to wrong event message")
        }
    }
}
