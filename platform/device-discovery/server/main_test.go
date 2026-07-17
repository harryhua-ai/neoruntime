package main

import (
	"testing"

	"aipc/platform/device-discovery/discovery"
)

func TestMatchesSetNetworkTargetMACIsAuthoritative(t *testing.T) {
	cfg := discovery.SetNetwork{
		SN:  "shared-cloned-serial",
		MAC: "02:00:00:00:00:01",
	}

	if matchesSetNetworkTarget(cfg, "shared-cloned-serial", "02:00:00:00:00:02") {
		t.Fatal("device with the same SN but a different MAC must not match")
	}
	if !matchesSetNetworkTarget(cfg, "different-serial", "02:00:00:00:00:01") {
		t.Fatal("matching MAC should select the target device")
	}
}

func TestMatchesSetNetworkTargetLegacySNFallback(t *testing.T) {
	cfg := discovery.SetNetwork{SN: "legacy-device"}

	if !matchesSetNetworkTarget(cfg, "legacy-device", "02:00:00:00:00:01") {
		t.Fatal("command without MAC should fall back to matching SN")
	}
	if matchesSetNetworkTarget(cfg, "other-device", "02:00:00:00:00:01") {
		t.Fatal("different SN must not match a legacy command")
	}
}

func TestMatchesSetNetworkTargetFailsClosed(t *testing.T) {
	tests := []struct {
		name  string
		cfg   discovery.SetNetwork
		mySN  string
		myMAC string
	}{
		{
			name:  "target MAC present but local MAC unavailable",
			cfg:   discovery.SetNetwork{SN: "same-sn", MAC: "02:00:00:00:00:01"},
			mySN:  "same-sn",
			myMAC: "",
		},
		{
			name:  "no target identity",
			cfg:   discovery.SetNetwork{},
			mySN:  "same-sn",
			myMAC: "02:00:00:00:00:01",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if matchesSetNetworkTarget(tt.cfg, tt.mySN, tt.myMAC) {
				t.Fatal("ambiguous target must not match")
			}
		})
	}
}
