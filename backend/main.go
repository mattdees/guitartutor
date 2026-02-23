package main

import (
	"net/http"

	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"

	"guitartutor/backend/handlers"
)

func main() {
	r := gin.Default()

	// CORS — permissive during development; nginx proxy removes the need for this in production.
	r.Use(cors.New(cors.Config{
		AllowOrigins: []string{"*"},
		AllowMethods: []string{http.MethodGet, http.MethodPost, http.MethodOptions},
		AllowHeaders: []string{"Origin", "Content-Type"},
	}))

	api := r.Group("/api")
	{
		api.GET("/instruments", handlers.GetInstruments)
		api.GET("/progressions", handlers.GetProgressions)
		api.GET("/chords/:instrument", handlers.GetChords)
		api.POST("/chords/batch", handlers.BatchChords)
		api.POST("/transpose", handlers.Transpose)
		api.POST("/midi", handlers.GenerateMidi)
	}

	r.Run(":8080")
}
