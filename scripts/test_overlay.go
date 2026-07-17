// Test script: publishes fake detection results to Event Bus
// to verify camera-daemon AI overlay drawing pipeline.
//
// Build:  cd <repo-root> && go build -o test_overlay ./scripts/test_overlay.go
// Run:    ./test_overlay [-endpoint unix:///run/aipc/event-bus.sock] [-stream main]
//
// ARM:    CGO_ENABLED=0 GOOS=linux GOARCH=arm64 go build -o test_overlay_arm64 ./scripts/test_overlay.go

package main

import (
	"context"
	"flag"
	"fmt"
	"math"
	"net"
	"os"
	"strings"
	"time"

	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"

	pb "aipc/platform/event-bus/proto"
)

var (
	endpoint = flag.String("endpoint", "unix:///run/aipc/event-bus.sock", "Event Bus endpoint")
	stream   = flag.String("stream", "main", "Stream name")
	model    = flag.String("model", "yolov8", "Model ID")
	fps      = flag.Float64("fps", 5, "Publish rate (detections per second)")
)

func dialEventBus(ep string) (*grpc.ClientConn, error) {
	// Parse unix socket path
	path := ep
	if strings.HasPrefix(path, "unix:///") {
		path = path[7:]
	} else if strings.HasPrefix(path, "unix:") {
		path = path[5:]
	}

	if strings.HasPrefix(path, "/") {
		return grpc.Dial("unix://"+path,
			grpc.WithTransportCredentials(insecure.NewCredentials()),
			grpc.WithBlock(),
			grpc.WithTimeout(5*time.Second))
	}
	// TCP
	return grpc.Dial(ep,
		grpc.WithTransportCredentials(insecure.NewCredentials()),
		grpc.WithBlock(),
		grpc.WithTimeout(5*time.Second))
}

func main() {
	flag.Parse()

	// Verify socket exists for unix endpoints
	path := *endpoint
	if strings.HasPrefix(path, "unix:///") {
		path = path[7:]
	}
	if strings.HasPrefix(path, "/") {
		if _, err := os.Stat(path); err != nil {
			fmt.Fprintf(os.Stderr, "Socket not found: %s\n", path)
			os.Exit(1)
		}
	}

	conn, err := dialEventBus(*endpoint)
	if err != nil {
		// Fallback: try direct unix dial
		sockPath := *endpoint
		if strings.HasPrefix(sockPath, "unix:///") {
			sockPath = sockPath[7:]
		}
		conn, err = grpc.Dial("passthrough:///unix",
			grpc.WithTransportCredentials(insecure.NewCredentials()),
			grpc.WithBlock(),
			grpc.WithTimeout(5*time.Second),
			grpc.WithDialer(func(addr string, timeout time.Duration) (net.Conn, error) {
				return net.DialTimeout("unix", sockPath, timeout)
			}))
		if err != nil {
			fmt.Fprintf(os.Stderr, "Failed to connect: %v\n", err)
			os.Exit(1)
		}
	}
	defer conn.Close()

	client := pb.NewEventBusClient(conn)
	fmt.Printf("Connected to Event Bus: %s\n", *endpoint)
	fmt.Printf("Publishing fake detections: stream=%s model=%s fps=%.1f\n", *stream, *model, *fps)
	fmt.Println("Press Ctrl+C to stop")

	ticker := time.NewTicker(time.Duration(float64(time.Second) / *fps))
	defer ticker.Stop()

	frameSeq := uint64(0)
	for range ticker.C {
		frameSeq++
		ts := uint64(time.Now().UnixNano())

		// Animate a bounding box moving across the frame
		t := float64(frameSeq) * 0.02
		cx := 0.3 + 0.2*math.Sin(t)
		cy := 0.3 + 0.15*math.Cos(t*0.7)
		w := 0.15
		h := 0.20

		payload := fmt.Sprintf(
			`{"stream_id":"%s","model_id":"%s","frame_sequence":%d,"timestamp_ns":%d,"num_detections":2,"detections":[`+
				`{"class_id":0,"label":"person","confidence":0.92,"bbox":[%.4f,%.4f,%.4f,%.4f]},`+
				`{"class_id":1,"label":"car","confidence":0.85,"bbox":[0.6,0.5,0.2,0.15]}`+
				`]}`,
			*stream, *model, frameSeq, ts, cx, cy, w, h)

		topic := "inference/*" + *model + "/" + *stream

		resp, err := client.Publish(context.Background(), &pb.PublishRequest{
			Event: &pb.Event{
				Topic:       topic,
				Source:      "test_overlay",
				TimestampNs: ts,
				EventId:     fmt.Sprintf("test-%d", frameSeq),
				Payload:     []byte(payload),
				PayloadType: "json",
				Metadata: map[string]string{
					"stream_id": *stream,
					"model_id":  *model,
				},
			},
		})

		if err != nil {
			fmt.Fprintf(os.Stderr, "Publish failed: %v\n", err)
			continue
		}
		if frameSeq%10 == 0 {
			fmt.Printf("  [%d] published (ok=%v)\n", frameSeq, resp.GetStatus().GetSuccess())
		}
	}
}
