import Foundation
import OpenPIProtocol

func expect(_ condition: @autoclosure () -> Bool, _ message: String = "", file: StaticString = #file, line: UInt = #line) {
    if !condition() {
        print("❌ Expectation failed: \(message) at \(file):\(line)")
        exit(1)
    }
}

print("🧪 Running OpenPI Swift Protocol & Serialization Tests...")

// Test 1: JSONLines chunking & framing
do {
    let chunk1 = "{\"id\":\"1\",\"type\":\"health\"}\n{\"id\":\"2\"".data(using: .utf8)!
    let (lines1, rest1) = JSONLinesCodec.decodeLines(buffer: Data(), newChunk: chunk1)

    expect(lines1.count == 1, "Expected 1 line extracted")
    expect(String(data: lines1[0], encoding: .utf8) == "{\"id\":\"1\",\"type\":\"health\"}", "Line 0 matches")
    expect(String(data: rest1, encoding: .utf8) == "{\"id\":\"2\"", "Rest matches partial line")

    let chunk2 = ",\"type\":\"shutdown\"}\n".data(using: .utf8)!
    let (lines2, rest2) = JSONLinesCodec.decodeLines(buffer: rest1, newChunk: chunk2)

    expect(lines2.count == 1, "Expected 1 line extracted from second chunk")
    expect(String(data: lines2[0], encoding: .utf8) == "{\"id\":\"2\",\"type\":\"shutdown\"}", "Line 1 matches")
    expect(rest2.isEmpty, "Rest should be empty after newline")
    print("  ✅ JSONLines chunking & framing passed")
}

// Test 2: ClientRequest serialization & deserialization
do {
    let req = ClientRequest.createSession(
        id: "req_100",
        cwd: "/Users/test/workspace",
        mode: .code,
        model: "anthropic/claude-3-7-sonnet",
        name: "Test Coding Session",
        inMemory: false
    )
    let encoded = try JSONLinesCodec.encode(req)
    let (lines, _) = JSONLinesCodec.decodeLines(buffer: Data(), newChunk: encoded)
    expect(lines.count == 1, "Encoded should form 1 JSONL line")

    let decoded = try JSONDecoder().decode(ClientRequest.self, from: lines[0])
    expect(decoded.requestId == "req_100", "RequestId matches")

    if case .createSession(let id, let cwd, let mode, let model, let name, let inMem) = decoded {
        expect(id == "req_100")
        expect(cwd == "/Users/test/workspace")
        expect(mode == .code)
        expect(model == "anthropic/claude-3-7-sonnet")
        expect(name == "Test Coding Session")
        expect(inMem == false)
    } else {
        expect(false, "Decoded request type mismatch")
    }
    print("  ✅ ClientRequest serialization & deserialization passed")
}

// Test 3: ServerMessage responses and events
do {
    let resp = ServerMessage.successResponse(
        id: "req_100",
        data: .object(["status": .string("ok"), "sessionCount": .number(5)])
    )
    let encodedResp = try JSONEncoder().encode(resp)
    let decodedResp = try JSONDecoder().decode(ServerMessage.self, from: encodedResp)

    if case .successResponse(let id, let data) = decodedResp {
        expect(id == "req_100")
        expect(data?["status"]?.stringValue == "ok")
        expect(data?["sessionCount"]?.intValue == 5)
    } else {
        expect(false, "Decoded server response mismatch")
    }

    let event = ServerMessage.event(
        sessionId: "session_abc",
        event: [
            "type": .string("message_delta"),
            "delta": .object(["role": .string("assistant"), "content": .string("Hello world")])
        ]
    )
    let encodedEvt = try JSONEncoder().encode(event)
    let decodedEvt = try JSONDecoder().decode(ServerMessage.self, from: encodedEvt)

    if case .event(let sid, let payload) = decodedEvt {
        expect(sid == "session_abc")
        expect(payload["type"]?.stringValue == "message_delta")
        expect(payload["delta"]?["content"]?.stringValue == "Hello world")
    } else {
        expect(false, "Decoded event mismatch")
    }
    print("  ✅ ServerMessage serialization & deserialization passed")
}

// Test 4: Jev Choice, Noul, Score serialization & AppOp
do {
    let choiceReq = JevChoiceRequest(
        context: "Executing rm -rf /Users/test",
        choices: ["safe_execute", "warn_confirm", "blocked"],
        instruction: "Safety triage"
    )
    let appOp = AppOp.jevDecide(
        context: choiceReq.context,
        choices: choiceReq.choices,
        instruction: choiceReq.instruction
    )
    let clientReq = ClientRequest.app(id: "jev_001", op: appOp)
    let encodedReq = try JSONLinesCodec.encode(clientReq)
    let (lines, _) = JSONLinesCodec.decodeLines(buffer: Data(), newChunk: encodedReq)
    expect(lines.count == 1, "Jev request should serialize to 1 JSONL line")

    let decoded = try JSONDecoder().decode(ClientRequest.self, from: lines[0])
    expect(decoded.requestId == "jev_001")

    let choiceResp = JevChoiceResponse(
        selected: "blocked",
        confidence: 0.99,
        probabilities: ["safe_execute": 0.0, "warn_confirm": 0.01, "blocked": 0.99],
        latencyMs: 3.2,
        provider: "native-fast"
    )
    let encodedResp = try JSONEncoder().encode(choiceResp)
    let decodedResp = try JSONDecoder().decode(JevChoiceResponse.self, from: encodedResp)
    expect(decodedResp.selected == "blocked")
    expect(decodedResp.confidence == 0.99)
    expect(decodedResp.probabilities["blocked"] == 0.99)
    expect(decodedResp.provider == "native-fast")

    let noulResp = JevNoulResponse(
        verdict: false,
        confidence: 0.98,
        latencyMs: 2.1,
        provider: "native-fast"
    )
    let encodedNoul = try JSONEncoder().encode(noulResp)
    let decodedNoul = try JSONDecoder().decode(JevNoulResponse.self, from: encodedNoul)
    expect(decodedNoul.verdict == false)
    expect(decodedNoul.confidence == 0.98)

    print("  ✅ Jev Choice & Noul serialization & round-trip passed")
}

print("🎉 All Protocol & Jev unit tests passed successfully!")

