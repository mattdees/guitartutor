package main

import (
	"log"
	"net/http"
	"os"
	"strings"

	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"

	"guitartutor/backend/handlers"
)

func main() {
	r := gin.Default()

	// CORS — origins configurable via CORS_ORIGINS env var (comma-separated).
	// Defaults to * for local development; set a specific origin in production.
	originsEnv := os.Getenv("CORS_ORIGINS")
	if originsEnv == "" {
		originsEnv = "*"
	}
	r.Use(cors.New(cors.Config{
		AllowOrigins: strings.Split(originsEnv, ","),
		AllowMethods: []string{http.MethodGet, http.MethodPost, http.MethodOptions},
		AllowHeaders: []string{"Origin", "Content-Type"},
	}))

	r.GET("/health", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"status": "ok"})
	})

	api := r.Group("/api")
	{
		api.GET("/instruments", handlers.GetInstruments)
		api.GET("/progressions", handlers.GetProgressions)
		api.GET("/chords/:instrument", handlers.GetChords)
		api.POST("/chords/batch", handlers.BatchChords)
		api.POST("/transpose", handlers.Transpose)
		api.POST("/midi", handlers.GenerateMidi)
	}

	if err := r.Run(":8080"); err != nil {
		log.Fatalf("server failed to start: %v", err)
	}
}
