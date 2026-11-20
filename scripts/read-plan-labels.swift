// Offline OCR of public floor-plan labels. Images never leave this computer.
import Foundation
import Vision
import ImageIO

for path in CommandLine.arguments.dropFirst() {
    do {
        let url = URL(fileURLWithPath: path)
        guard let source = CGImageSourceCreateWithURL(url as CFURL, nil),
              let image = CGImageSourceCreateImageAtIndex(source, 0, nil) else { continue }
        let request = VNRecognizeTextRequest()
        request.recognitionLevel = .accurate
        request.recognitionLanguages = ["ko-KR", "en-US"]
        request.usesLanguageCorrection = false
        try VNImageRequestHandler(cgImage: image).perform([request])
        let texts: [[String: Any]] = (request.results ?? []).compactMap { observation in
            guard let text = observation.topCandidates(1).first else { return nil }
            let box = observation.boundingBox
            return ["text": text.string, "confidence": text.confidence,
                    "bounds": ["x": box.minX, "y": 1-box.maxY, "width": box.width, "height": box.height]]
        }
        let output: [String: Any] = ["file": path, "width": image.width, "height": image.height, "texts": texts]
        let data = try JSONSerialization.data(withJSONObject: output, options: [.sortedKeys])
        print(String(data: data, encoding: .utf8)!)
    } catch {
        fputs("Could not analyze \(URL(fileURLWithPath:path).lastPathComponent): \(error)\n", stderr)
    }
}
