package ratelimit

import (
	"sync"
	"testing"
)

func TestGatePerKey(t *testing.T) {
	g := NewGate(2, 10)

	leaveFirst, ok := g.Enter("a")
	if !ok {
		t.Fatal("first refused")
	}
	if _, ok := g.Enter("a"); !ok {
		t.Fatal("second refused")
	}
	if _, ok := g.Enter("a"); ok {
		t.Fatal("a third entered for a key capped at two")
	}
	// Another key has its own count.
	if _, ok := g.Enter("b"); !ok {
		t.Fatal("another key refused")
	}

	// One leaves, one can enter; leaving twice frees one place, not two.
	leaveFirst()
	leaveFirst()
	if _, ok := g.Enter("a"); !ok {
		t.Fatal("refused after one left")
	}
	if _, ok := g.Enter("a"); ok {
		t.Fatal("leaving twice freed two places")
	}
}

func TestGateTotal(t *testing.T) {
	g := NewGate(2, 3)
	var leave []func()
	for _, key := range []string{"a", "a", "b"} {
		l, ok := g.Enter(key)
		if !ok {
			t.Fatalf("key %s refused", key)
		}
		leave = append(leave, l)
	}
	// Full: nobody enters, whatever their own count.
	for _, key := range []string{"b", "c"} {
		if _, ok := g.Enter(key); ok {
			t.Fatalf("key %s entered a full gate", key)
		}
	}
	leave[0]()
	if _, ok := g.Enter("c"); !ok {
		t.Fatal("refused after one left")
	}
	if _, ok := g.Enter("d"); ok {
		t.Fatal("entered a full gate")
	}
}

func TestGateKeepsNothingForThoseWhoLeft(t *testing.T) {
	g := NewGate(5, 100)
	var leave []func()
	for _, key := range []string{"a", "a", "b", "c"} {
		l, _ := g.Enter(key)
		leave = append(leave, l)
	}
	// A refusal leaves no trace either.
	full := NewGate(1, 1)
	full.Enter("a")
	full.Enter("b")
	if len(full.open) != 1 || full.all != 1 {
		t.Fatalf("after a refusal: %d keys, %d in all", len(full.open), full.all)
	}

	for _, l := range leave {
		l()
	}
	if len(g.open) != 0 || g.all != 0 {
		t.Fatalf("after everyone left: %d keys, %d in all", len(g.open), g.all)
	}
}

func TestGateConcurrentUse(t *testing.T) {
	g := NewGate(3, 8)
	var wg sync.WaitGroup
	for i := range 16 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			key := string(rune('a' + i%4))
			for range 200 {
				if leave, ok := g.Enter(key); ok {
					leave()
				}
			}
		}()
	}
	wg.Wait()
	if len(g.open) != 0 || g.all != 0 {
		t.Fatalf("after everyone left: %d keys, %d in all", len(g.open), g.all)
	}
}

func TestStreamCaps(t *testing.T) {
	if MaxStreamsPerKey != 20 || MaxStreams != 2000 {
		t.Fatalf("caps are %d per key and %d in all", MaxStreamsPerKey, MaxStreams)
	}
}
