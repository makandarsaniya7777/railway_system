// Book Tickets Page
document.getElementById('searchForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  
  const response = await fetch('/api/trains');
  const trains = await response.json();
  
  const results = trains.map(train => `
    <div class="train-card">
      <h3>${train.name}</h3>
      <p>${train.source} to ${train.destination}</p>
      <p>Seats available: ${train.available_seats}</p>
      <button onclick="bookTrain(${train.id})">Book Now</button>
    </div>
  `).join('');
  
  document.getElementById('trainResults').innerHTML = results;
});

async function bookTrain(trainId) {
  const name = prompt('Enter passenger name:');
  const response = await fetch('/api/book', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ train_id: trainId, passenger_name: name })
  });
  
  const result = await response.json();
  alert(`Booking confirmed! Your PNR: ${result.pnr}`);
}

// PNR Status Page
document.getElementById('pnrForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const pnr = e.target[0].value;
  
  const response = await fetch(`/api/pnr/${pnr}`);
  const data = await response.json();
  
  const resultDiv = document.getElementById('pnrResult');
  if(data.error) {
    resultDiv.innerHTML = `<p class="error">${data.error}</p>`;
  } else {
    resultDiv.innerHTML = `
      <div class="pnr-status">
        <h3>Status: ${data.status}</h3>
        <p>Train: ${data.train_name}</p>
        <p>Passenger: ${data.passenger_name}</p>
      </div>
    `;
  }
});

// Help Page
document.getElementById('feedbackForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = e.target[0].value;
  const message = e.target[1].value;
  
  await fetch('/api/feedback', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, message })
  });
  
  alert('Thank you for your feedback!');
  e.target.reset();
});
