import Foundation

public struct JSONLinesCodec: Sendable {
    public static let newline: UInt8 = 0x0A

    public static func encode<T: Encodable>(_ value: T) throws -> Data {
        let encoder = JSONEncoder()
        var data = try encoder.encode(value)
        data.append(newline)
        return data
    }

    public static func decodeLines(
        buffer: Data,
        newChunk: Data
    ) -> (lines: [Data], rest: Data) {
        var combined = buffer
        combined.append(newChunk)

        var lines: [Data] = []
        var startIndex = combined.startIndex

        while let newlineIndex = combined[startIndex...].firstIndex(of: newline) {
            let lineData = combined[startIndex..<newlineIndex]
            if !lineData.isEmpty {
                lines.append(Data(lineData))
            }
            startIndex = combined.index(after: newlineIndex)
        }

        let rest = Data(combined[startIndex...])
        return (lines, rest)
    }

    public static func parseJSON<T: Decodable>(_ data: Data, as type: T.Type = T.self) -> Result<T, Error> {
        let decoder = JSONDecoder()
        do {
            let decoded = try decoder.decode(T.self, from: data)
            return .success(decoded)
        } catch {
            return .failure(error)
        }
    }
}
